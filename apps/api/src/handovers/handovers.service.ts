import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { normalizeEpc, todayInKenya, type Permission } from '@ilacore/domain';
import { randomInt } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { requireAt } from '../access/require-at.js';
import { newSmsCode } from '../customers/customers.service.js';
import { CODE_WINDOW_MS, MAX_CODE_ATTEMPTS, SmsService } from '../customers/sms.js';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import { recordEvent, recordEvents } from '../events/record-event.js';
import type { RequestMeta } from '../http/request.js';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';
import { hashSecret, verifySecret } from '../identity/hashing.js';

/** Most tags accepted in one scan call. */
export const MAX_TAGS_PER_CALL = 500;
/** Longest "empties owed" a driver can ask for. */
const MAX_OWED_DAYS = 60;

/** Who may look at a trip's handovers at its depot. The trip's driver always may. */
const VIEW: readonly Permission[] = ['dispatch.scan', 'dispatch.approve_exception', 'handover.approve_exception', 'route.settle', 'item.view_position'];

export type HandoverStatus = 'open' | 'awaiting_confirmation' | 'confirmed' | 'unconfirmed' | 'disputed' | 'cancelled';

export type OutOutcome =
  | { epc: string; result: 'added' | 'already_scanned'; itemId: string }
  | { epc: string; result: 'refused'; reason: 'not_a_tag' | 'unknown_tag' | 'not_on_this_truck' | 'not_full'; itemId?: string };

export type InOutcome =
  | { epc: string; result: 'added' | 'already_scanned'; itemId: string }
  | { epc: string; result: 'not_ours' }
  | { epc: string; result: 'refused'; reason: 'on_a_truck' | 'going_out'; itemId: string };

export interface Balance {
  fullOut: number;
  emptyIn: number;
  soldOutright: number;
  /** Fulls with no empty or sale against them. An approved "owed" is applied separately. */
  uncovered: number;
}

interface HandoverRow {
  id: string;
  trip_id: string;
  depot_id: string;
  vehicle_reg: string;
  driver_id: string;
  customer_id: string;
  customer_name: string;
  customer_kind: 'retailer' | 'wholesaler';
  customer_phone: string;
  giver_id: string;
  giver_name: string;
  status: HandoverStatus;
  ref: string;
  opened_at: Date;
  owed_count: number | null;
  owed_due_on: string | null;
  owed_approved_at: Date | null;
  owed_approved_by_name: string | null;
  full_out: number | null;
  empty_in: number | null;
  sold_out: number | null;
  shortfall: number | null;
  code_hash: string | null;
  code_expires_at: Date | null;
  code_attempts: number;
  codes_sent: number;
  closed_at: Date | null;
  dispute_note: string | null;
}

const HANDOVER = `
  SELECT h.id, h.trip_id, h.customer_id, h.giver_id, h.status, h.ref, h.opened_at, h.owed_count,
         to_char(h.owed_due_on, 'YYYY-MM-DD') AS owed_due_on, h.owed_approved_at, h.full_out, h.empty_in, h.sold_out,
         h.shortfall, h.code_hash, h.code_expires_at, h.code_attempts, h.codes_sent, h.closed_at, h.dispute_note,
         tr.depot_id, tr.vehicle_reg, tr.driver_id,
         cu.name AS customer_name, cu.kind AS customer_kind, cu.phone AS customer_phone,
         g.display_name AS giver_name, ap.display_name AS owed_approved_by_name
  FROM handovers h
  JOIN trips tr ON tr.id = h.trip_id
  JOIN customers cu ON cu.id = h.customer_id
  JOIN users g ON g.id = h.giver_id
  LEFT JOIN users ap ON ap.id = h.owed_approved_by`;

const deviceOf = (actor: AuthContext) => (actor.deviceId ? { deviceId: actor.deviceId } : {});

function cleanTags(raw: readonly string[]): { epcs: string[]; invalid: string[] } {
  if (raw.length === 0 || raw.length > MAX_TAGS_PER_CALL) {
    throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', `Send between 1 and ${MAX_TAGS_PER_CALL} tags.`);
  }
  const epcs: string[] = [];
  const invalid: string[] = [];
  for (const r of raw) {
    const epc = normalizeEpc(r);
    if (!epc) invalid.push(r.trim().slice(0, 80) || '?');
    else if (!epcs.includes(epc)) epcs.push(epc);
  }
  return { epcs, invalid };
}

/** Fulls not covered by an empty back or an outright sale. */
function uncoveredOf(fullOut: number, emptyIn: number, soldOutright: number): number {
  return Math.max(0, fullOut - soldOutright - emptyIn);
}

/**
 * A driver's handover to a retailer or wholesaler from a trip that is out (docs/design/custody-and-liability.md).
 * The driver scans fulls out and empties in, the balance is shown, a supervisor may approve "empties owed", the
 * customer is sent a code and reads it to the driver. Only then does custody move.
 */
@Injectable()
export class HandoversService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(SmsService) private readonly sms: SmsService,
  ) {}

  /**
   * The trip's driver starts a handover to a customer. A handheld may choose the id itself (it does so when the
   * handover was started with no signal and is sent later): sending the same start twice returns the same
   * handover, and an id already used for anything else is refused.
   */
  async open(actor: AuthContext, tripId: string, customerId: string, meta: RequestMeta, clientId?: string): Promise<{ id: string; ref: string }> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      await this.expireStale(c);
      if (clientId) {
        const seen = await c.query<{ trip_id: string; customer_id: string; giver_id: string; ref: string }>(
          'SELECT trip_id, customer_id, giver_id, ref FROM handovers WHERE id = $1',
          [clientId],
        );
        const s = seen.rows[0];
        if (s) {
          if (s.trip_id === tripId && s.customer_id === customerId && s.giver_id === actor.userId) return { id: clientId, ref: s.ref };
          throw apiError(HttpStatus.CONFLICT, 'handover_id_taken', 'That handover id is already in use.');
        }
      }
      const trip = await c.query<{ driver_id: string; depot_id: string; status: string }>(
        'SELECT driver_id, depot_id, status FROM trips WHERE id = $1 FOR UPDATE',
        [tripId],
      );
      const t = trip.rows[0];
      if (!t) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such trip.');
      if (t.driver_id !== actor.userId) throw apiError(HttpStatus.FORBIDDEN, 'not_your_trip', 'Only the trip\'s driver hands over from it.');
      requireAt(actor, ['handover.perform'], t.depot_id);
      if (t.status !== 'out') throw apiError(HttpStatus.CONFLICT, 'trip_not_out', 'This trip has not gone out.');
      const cu = await c.query<{ phone_verified_at: Date | null }>('SELECT phone_verified_at FROM customers WHERE id = $1', [customerId]);
      if (!cu.rows[0]) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such customer.');
      if (!cu.rows[0].phone_verified_at) {
        throw apiError(HttpStatus.CONFLICT, 'phone_not_verified', 'This customer\'s number isn\'t verified yet, so they can\'t confirm.');
      }
      const live = await c.query(`SELECT 1 FROM handovers WHERE trip_id = $1 AND status IN ('open', 'awaiting_confirmation')`, [tripId]);
      if ((live.rowCount ?? 0) > 0) throw apiError(HttpStatus.CONFLICT, 'handover_in_progress', 'Finish the handover in progress first.');
      const ref = String(randomInt(1000, 10000));
      const r = await c.query<{ id: string }>(
        `INSERT INTO handovers (id, tenant_id, trip_id, customer_id, giver_id, ref)
         VALUES (COALESCE($5::uuid, gen_random_uuid()), current_tenant_id(), $1, $2, $3, $4) RETURNING id`,
        [tripId, customerId, actor.userId, ref, clientId ?? null],
      );
      const id = r.rows[0]!.id;
      await recordAudit(c, { action: 'handover.opened', actorId: actor.userId, deviceId: actor.deviceId ?? undefined, targetType: 'handover', targetId: id, details: { tripId, customerId }, ...meta });
      return { id, ref };
    });
  }

  async get(actor: AuthContext, id: string) {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      await this.expireStale(c);
      const h = await this.load(c, id);
      if (h.driver_id !== actor.userId) requireAt(actor, VIEW, h.depot_id);
      return this.detail(c, h);
    });
  }

  /** Fulls going to the customer. They must be on this driver's truck and full. */
  async scanOut(actor: AuthContext, id: string, raw: readonly string[]): Promise<{ outcomes: OutOutcome[]; balance: Balance }> {
    const { epcs, invalid } = cleanTags(raw);
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const h = await this.forGiver(c, actor, id);
      const found = await this.tagged(c, epcs, h);
      const outcomes: OutOutcome[] = invalid.map((epc) => ({ epc, result: 'refused', reason: 'not_a_tag' }));
      const add: { itemId: string; epc: string }[] = [];
      for (const epc of epcs) {
        const r = found.get(epc);
        if (!r) outcomes.push({ epc, result: 'refused', reason: 'unknown_tag' });
        else if (r.in_handover || add.some((a) => a.itemId === r.item_id)) outcomes.push({ epc, result: 'already_scanned', itemId: r.item_id });
        else if (!r.on_this_truck) outcomes.push({ epc, result: 'refused', reason: 'not_on_this_truck', itemId: r.item_id });
        else if (r.physical_state !== 'full') outcomes.push({ epc, result: 'refused', reason: 'not_full', itemId: r.item_id });
        else {
          add.push({ itemId: r.item_id, epc });
          outcomes.push({ epc, result: 'added', itemId: r.item_id });
        }
      }
      await this.addLines(c, id, add, 'out');
      return { outcomes, balance: await this.balance(c, id) };
    });
  }

  /**
   * Empties coming back. Any of our cylinders counts (where the system thought it was is kept as evidence, and
   * nothing is shown on screen), except one that is on a truck: that would let a driver balance with his own load.
   * Tags that aren't ours don't count; they are noted.
   */
  async scanIn(actor: AuthContext, id: string, raw: readonly string[]): Promise<{ outcomes: InOutcome[]; balance: Balance }> {
    const { epcs, invalid } = cleanTags(raw);
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const h = await this.forGiver(c, actor, id);
      const found = await this.tagged(c, epcs, h);
      const outcomes: InOutcome[] = [];
      const foreign = [...invalid];
      const add: { itemId: string; epc: string }[] = [];
      for (const epc of epcs) {
        const r = found.get(epc);
        if (!r) foreign.push(epc);
        else if (r.in_handover === 'in' || add.some((a) => a.itemId === r.item_id)) outcomes.push({ epc, result: 'already_scanned', itemId: r.item_id });
        else if (r.in_handover === 'out') outcomes.push({ epc, result: 'refused', reason: 'going_out', itemId: r.item_id });
        else if (r.on_a_truck) outcomes.push({ epc, result: 'refused', reason: 'on_a_truck', itemId: r.item_id });
        else {
          add.push({ itemId: r.item_id, epc });
          outcomes.push({ epc, result: 'added', itemId: r.item_id });
        }
      }
      for (const tag of foreign) outcomes.push({ epc: tag, result: 'not_ours' });
      if (foreign.length > 0) {
        await c.query(
          `INSERT INTO handover_foreign_tags (tenant_id, handover_id, tag) SELECT current_tenant_id(), $1, t FROM unnest($2::text[]) AS t`,
          [id, foreign],
        );
      }
      await this.addLines(c, id, add, 'in');
      return { outcomes, balance: await this.balance(c, id) };
    });
  }

  async removeLine(actor: AuthContext, id: string, itemId: string): Promise<{ balance: Balance }> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      await this.forGiver(c, actor, id);
      const r = await c.query('UPDATE handover_lines SET removed_at = now() WHERE handover_id = $1 AND item_id = $2 AND removed_at IS NULL', [id, itemId]);
      if (r.rowCount !== 1) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'That cylinder is not in this handover.');
      return { balance: await this.balance(c, id) };
    });
  }

  /** Marks a full as bought outright by the customer (no empty will come back for it). */
  async setSold(actor: AuthContext, id: string, itemId: string, sold: boolean): Promise<{ balance: Balance }> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      await this.forGiver(c, actor, id);
      const r = await c.query(
        `UPDATE handover_lines SET sold_outright = $3 WHERE handover_id = $1 AND item_id = $2 AND direction = 'out' AND removed_at IS NULL`,
        [id, itemId, sold],
      );
      if (r.rowCount !== 1) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'That full cylinder is not in this handover.');
      return { balance: await this.balance(c, id) };
    });
  }

  /** The driver asks a supervisor to let the customer owe the uncovered empties until a date. */
  async requestOwed(actor: AuthContext, id: string, dueOn: string): Promise<{ balance: Balance; owed: number }> {
    const today = todayInKenya();
    const latest = new Date(`${today}T00:00:00Z`);
    latest.setUTCDate(latest.getUTCDate() + MAX_OWED_DAYS);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn) || dueOn < today || dueOn > latest.toISOString().slice(0, 10)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', `Pick a date from today up to ${MAX_OWED_DAYS} days ahead.`, { fields: ['dueOn'] });
    }
    return withTenant(this.pool, actor.tenantId, async (c) => {
      await this.forGiver(c, actor, id);
      const balance = await this.balance(c, id);
      if (balance.uncovered === 0) throw apiError(HttpStatus.CONFLICT, 'nothing_owed', 'Every full is already covered.');
      await c.query(
        `UPDATE handovers SET owed_count = $2, owed_due_on = $3, owed_requested_at = now(), owed_approved_by = NULL, owed_approved_at = NULL
         WHERE id = $1`,
        [id, balance.uncovered, dueOn],
      );
      return { balance, owed: balance.uncovered };
    });
  }

  /** A depot supervisor approves "empties owed" while the driver waits. Never the driver himself. */
  async approveOwed(actor: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      await this.expireStale(c);
      const h = await this.load(c, id, true);
      requireAt(actor, ['handover.approve_exception'], h.depot_id);
      if (h.giver_id === actor.userId) throw apiError(HttpStatus.FORBIDDEN, 'separation_of_duties', 'The driver can\'t approve his own handover.');
      if (h.status !== 'open') throw apiError(HttpStatus.CONFLICT, 'handover_not_open', 'This handover is no longer open.');
      if (!h.owed_count || h.owed_approved_at) throw apiError(HttpStatus.CONFLICT, 'nothing_to_approve', 'Nothing is waiting for approval.');
      await c.query('UPDATE handovers SET owed_approved_by = $2, owed_approved_at = now() WHERE id = $1', [id, actor.userId]);
      await recordAudit(c, {
        action: 'handover.owed_approved', actorId: actor.userId, deviceId: actor.deviceId ?? undefined, targetType: 'handover', targetId: id,
        details: { owed: h.owed_count, dueOn: h.owed_due_on, customerId: h.customer_id }, ...meta,
      });
    });
  }

  /**
   * Freezes the counts and sends the customer the code. A shortfall (fulls with no cover and no approved "owed")
   * must be accepted explicitly; it is recorded against the driver if the handover is confirmed.
   */
  async requestConfirmation(actor: AuthContext, id: string, acceptShortfall: boolean, meta: RequestMeta) {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const h = await this.forGiver(c, actor, id);
      const b = await this.balance(c, id);
      if (b.fullOut === 0 && b.emptyIn === 0) throw apiError(HttpStatus.CONFLICT, 'nothing_to_hand_over', 'Scan the cylinders first.');
      const owed = h.owed_approved_at && h.owed_count ? Math.min(h.owed_count, b.uncovered) : 0;
      const shortfall = b.uncovered - owed;
      if (shortfall > 0 && !acceptShortfall) {
        throw apiError(HttpStatus.CONFLICT, 'unbalanced', `${shortfall} full ${shortfall === 1 ? 'cylinder has' : 'cylinders have'} no empty, sale or approval.`, {
          balance: b, shortfall,
        });
      }
      // The code goes first: the table refuses a handover waiting for confirmation with no code sent.
      const expiresAt = await this.sendCode(c, { ...h, owed_count: owed || null });
      // Only an approved "owed" survives; an unapproved request is dropped (it becomes part of the shortfall).
      await c.query(
        `UPDATE handovers SET status = 'awaiting_confirmation', full_out = $2, empty_in = $3, sold_out = $4, shortfall = $5,
                owed_count = $6,
                owed_due_on = CASE WHEN $6::int IS NULL THEN NULL ELSE owed_due_on END,
                owed_requested_at = CASE WHEN $6::int IS NULL THEN NULL ELSE owed_requested_at END,
                owed_approved_by = CASE WHEN $6::int IS NULL THEN NULL ELSE owed_approved_by END,
                owed_approved_at = CASE WHEN $6::int IS NULL THEN NULL ELSE owed_approved_at END
         WHERE id = $1`,
        [id, b.fullOut, b.emptyIn, b.soldOutright, shortfall, owed || null],
      );
      await recordAudit(c, {
        action: 'handover.confirmation_requested', actorId: actor.userId, deviceId: actor.deviceId ?? undefined, targetType: 'handover', targetId: id,
        details: { ...b, owed, shortfall }, ...meta,
      });
      return { expiresAt, balance: b, owed, shortfall };
    });
  }

  /** One fresh code, while the first is still within its window (the driver is still at the shop). */
  async resendCode(actor: AuthContext, id: string): Promise<{ expiresAt: Date }> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      await this.expireStale(c);
      const h = await this.load(c, id, true);
      this.checkGiver(actor, h);
      if (h.status !== 'awaiting_confirmation') throw apiError(HttpStatus.CONFLICT, 'not_awaiting_confirmation', 'This handover is not waiting for a code.');
      if (h.codes_sent >= 2) throw apiError(HttpStatus.CONFLICT, 'no_more_codes', 'A fresh code has already been sent once.');
      return { expiresAt: await this.sendCode(c, h) };
    });
  }

  /**
   * The driver types the code the customer read to him. On success custody moves: fulls to the customer (or sold
   * outright to them), empties onto the truck. Wrong tries count even though the request fails.
   */
  async confirm(actor: AuthContext, id: string, code: string, meta: RequestMeta) {
    const outcome = await withTenant(this.pool, actor.tenantId, async (c) => {
      await this.expireStale(c);
      const h = await this.load(c, id, true);
      this.checkGiver(actor, h);
      if (h.status === 'unconfirmed') return { error: 'expired' as const };
      if (h.status !== 'awaiting_confirmation') throw apiError(HttpStatus.CONFLICT, 'not_awaiting_confirmation', 'This handover is not waiting for a code.');
      if (h.code_attempts >= MAX_CODE_ATTEMPTS) return { error: 'too_many' as const };
      if (!(await verifySecret(h.code_hash, code))) {
        await c.query('UPDATE handovers SET code_attempts = code_attempts + 1 WHERE id = $1', [id]);
        return { error: 'wrong' as const };
      }
      return { done: await this.complete(c, actor, h, meta) };
    });
    if ('error' in outcome) {
      if (outcome.error === 'expired') throw apiError(HttpStatus.CONFLICT, 'confirmation_expired', 'The 15 minutes have passed. The handover was not confirmed.');
      if (outcome.error === 'too_many') throw apiError(HttpStatus.CONFLICT, 'too_many_attempts', 'Too many wrong tries.');
      throw apiError(HttpStatus.BAD_REQUEST, 'wrong_code', 'That code is not right.', { fields: ['code'] });
    }
    return outcome.done;
  }

  /** The customer says the counts are wrong. Nothing moves; the supervisor sees it on the trip. */
  async dispute(actor: AuthContext, id: string, note: string | undefined, meta: RequestMeta): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      await this.expireStale(c);
      const h = await this.load(c, id, true);
      this.checkGiver(actor, h);
      if (h.status !== 'awaiting_confirmation') throw apiError(HttpStatus.CONFLICT, 'not_awaiting_confirmation', 'This handover is not waiting for confirmation.');
      await c.query(`UPDATE handovers SET status = 'disputed', closed_at = now(), dispute_note = $2 WHERE id = $1`, [id, note?.trim() || null]);
      await recordEvent(c, { type: 'handover.disputed', aggregateType: 'handover', aggregateId: id, payload: { tripId: h.trip_id, customerId: h.customer_id }, actorId: actor.userId, ...deviceOf(actor), occurredAt: new Date() });
      await recordAudit(c, { action: 'handover.disputed', actorId: actor.userId, deviceId: actor.deviceId ?? undefined, targetType: 'handover', targetId: id, ...meta });
    });
  }

  /** Abandons a handover before the code is sent. Nothing moved. */
  async cancel(actor: AuthContext, id: string): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      await this.forGiver(c, actor, id);
      await c.query(`UPDATE handovers SET status = 'cancelled', closed_at = now() WHERE id = $1`, [id]);
    });
  }

  /** Handovers on a trip, for the trip page. The caller has already checked access to the trip. */
  async forTrip(c: PoolClient, tripId: string) {
    await this.expireStale(c);
    const r = await c.query<HandoverRow>(`${HANDOVER} WHERE h.trip_id = $1 ORDER BY h.opened_at`, [tripId]);
    const out = [];
    for (const h of r.rows) out.push(this.summary(h, h.full_out === null ? await this.balance(c, h.id) : this.frozen(h)));
    return out;
  }

  // --- internals -------------------------------------------------------------------------------------------

  private async complete(c: PoolClient, actor: AuthContext, h: HandoverRow, meta: RequestMeta) {
    const lines = await c.query<{
      item_id: string; direction: 'out' | 'in'; sold_outright: boolean; epc: string;
      custody_kind: string; custody_holder_id: string | null; custody_location_id: string | null;
    }>(
      `SELECT l.item_id, l.direction, l.sold_outright, l.epc, i.custody_kind, i.custody_holder_id, i.custody_location_id
       FROM handover_lines l JOIN tracked_items i ON i.id = l.item_id
       WHERE l.handover_id = $1 AND l.removed_at IS NULL
       FOR UPDATE OF i`,
      [h.id],
    );
    const out = lines.rows.filter((l) => l.direction === 'out');
    const ins = lines.rows.filter((l) => l.direction === 'in');
    // Nothing else should have touched these cylinders meanwhile; if something did, refuse rather than move the wrong thing.
    if (out.some((l) => l.custody_kind !== 'truck' || l.custody_holder_id !== h.trip_id)) {
      throw apiError(HttpStatus.CONFLICT, 'load_changed', 'A cylinder in this handover is no longer on the truck.');
    }
    if (ins.length > 0) {
      const live = await c.query(
        'SELECT 1 FROM trip_lines WHERE item_id = ANY($1::uuid[]) AND removed_at IS NULL AND returned_at IS NULL AND delivered_at IS NULL',
        [ins.map((l) => l.item_id)],
      );
      if ((live.rowCount ?? 0) > 0) throw apiError(HttpStatus.CONFLICT, 'load_changed', 'An empty in this handover is now on a truck.');
    }

    const delivered = out.filter((l) => !l.sold_outright).map((l) => l.item_id);
    const sold = out.filter((l) => l.sold_outright).map((l) => l.item_id);
    if (delivered.length > 0) {
      await c.query(
        `UPDATE tracked_items SET custody_kind = $2, custody_location_id = NULL, custody_holder_id = $3, updated_at = now() WHERE id = ANY($1::uuid[])`,
        [delivered, h.customer_kind, h.customer_id],
      );
    }
    if (sold.length > 0) {
      await c.query(
        `UPDATE tracked_items SET custody_kind = 'sold_outright', owner_kind = 'buyer', custody_location_id = NULL, custody_holder_id = $2, updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [sold, h.customer_id],
      );
    }
    if (out.length > 0) {
      await c.query(
        `UPDATE trip_lines SET delivered_at = now(), delivered_in = $3
         WHERE trip_id = $1 AND item_id = ANY($2::uuid[]) AND removed_at IS NULL AND returned_at IS NULL AND delivered_at IS NULL`,
        [h.trip_id, out.map((l) => l.item_id), h.id],
      );
    }
    if (ins.length > 0) {
      await c.query(
        `UPDATE tracked_items SET custody_kind = 'truck', custody_location_id = NULL, custody_holder_id = $2, physical_state = 'empty', updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [ins.map((l) => l.item_id), h.trip_id],
      );
      await c.query(
        `INSERT INTO trip_lines (tenant_id, trip_id, item_id, epc, physical_state, added_by, collected_in)
         SELECT current_tenant_id(), $1, r.item_id, r.epc, 'empty', $2, $3 FROM unnest($4::uuid[], $5::text[]) AS r(item_id, epc)`,
        [h.trip_id, h.giver_id, h.id, ins.map((l) => l.item_id), ins.map((l) => l.epc)],
      );
    }
    await c.query(`UPDATE handovers SET status = 'confirmed', closed_at = now() WHERE id = $1`, [h.id]);

    const now = new Date();
    const common = { handoverId: h.id, tripId: h.trip_id, customerId: h.customer_id, vehicleReg: h.vehicle_reg };
    const by = { actorId: actor.userId, ...deviceOf(actor), occurredAt: now };
    await recordEvents(c, [
      ...delivered.map((itemId) => ({ type: 'item.delivered', aggregateType: 'tracked_item', aggregateId: itemId, payload: { ...common, customerKind: h.customer_kind }, ...by })),
      ...sold.map((itemId) => ({ type: 'item.sold_outright', aggregateType: 'tracked_item', aggregateId: itemId, payload: common, ...by })),
      ...ins.map((l) => ({
        type: 'item.collected', aggregateType: 'tracked_item', aggregateId: l.item_id,
        // Where the system thought it was: evidence for investigations, never shown on the driver's screen.
        payload: { ...common, from: { kind: l.custody_kind, locationId: l.custody_location_id, holderId: l.custody_holder_id } },
        ...by,
      })),
    ]);
    const counts = { delivered: delivered.length, soldOutright: sold.length, collected: ins.length, owed: h.owed_count ?? 0, shortfall: h.shortfall ?? 0 };
    await recordEvent(c, { type: 'handover.confirmed', aggregateType: 'handover', aggregateId: h.id, payload: { ...common, ...counts }, ...by });
    await recordAudit(c, { action: 'handover.confirmed', actorId: actor.userId, deviceId: actor.deviceId ?? undefined, targetType: 'handover', targetId: h.id, details: counts, ...meta });
    return counts;
  }

  private async sendCode(c: PoolClient, h: HandoverRow): Promise<Date> {
    const code = newSmsCode();
    const expiresAt = new Date(Date.now() + CODE_WINDOW_MS);
    await c.query(
      `UPDATE handovers SET code_hash = $2, code_sent_at = now(), code_expires_at = $3, code_attempts = 0, codes_sent = codes_sent + 1 WHERE id = $1`,
      [h.id, await hashSecret(code), expiresAt],
    );
    const sizes = await c.query<{ direction: string; sold_outright: boolean; size: string; n: string }>(
      `SELECT l.direction, l.sold_outright, z.name AS size, count(*) AS n
       FROM handover_lines l JOIN cylinders cy ON cy.item_id = l.item_id JOIN cylinder_sizes z ON z.id = cy.size_id
       WHERE l.handover_id = $1 AND l.removed_at IS NULL
       GROUP BY l.direction, l.sold_outright, z.name, z.nominal_fill_kg ORDER BY z.nominal_fill_kg`,
      [h.id],
    );
    const part = (dir: string, sold: boolean, word: string) => {
      const xs = sizes.rows.filter((s) => s.direction === dir && s.sold_outright === sold).map((s) => `${s.n}x${s.size.replace(/\s/g, '')}`);
      return xs.length ? `${xs.join(', ')} ${word}` : '';
    };
    const given = [part('out', false, 'FULL given'), part('out', true, 'BOUGHT'), part('in', false, 'EMPTY taken')].filter(Boolean);
    const owed = h.owed_count ? ` ${h.owed_count} EMPTY owed by ${h.owed_due_on}.` : '';
    await this.sms.send(c, {
      customerId: h.customer_id,
      handoverId: h.id,
      purpose: 'handover_code',
      to: h.customer_phone,
      body: `ILACORE: ${h.giver_name} (${h.vehicle_reg}) at ${h.customer_name}. ${given.join(', ')}.${owed} Ref ${h.ref}. If correct, give the driver code ${code}. If wrong, tell the driver.`,
      secret: code,
    });
    return expiresAt;
  }

  /** Marks handovers whose 15 minutes passed as unconfirmed. Custody never moved, so nothing else changes. */
  private async expireStale(c: PoolClient): Promise<void> {
    await c.query(
      `UPDATE handovers SET status = 'unconfirmed', closed_at = code_expires_at
       WHERE status = 'awaiting_confirmation' AND code_expires_at < now()`,
    );
  }

  private async load(c: PoolClient, id: string, lock = false): Promise<HandoverRow> {
    const r = await c.query<HandoverRow>(`${HANDOVER} WHERE h.id = $1${lock ? ' FOR UPDATE OF h' : ''}`, [id]);
    if (!r.rows[0]) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such handover.');
    return r.rows[0];
  }

  private checkGiver(actor: AuthContext, h: HandoverRow): void {
    if (h.giver_id !== actor.userId) throw apiError(HttpStatus.FORBIDDEN, 'not_your_handover', 'Only the driver doing this handover can change it.');
    requireAt(actor, ['handover.perform'], h.depot_id);
  }

  /** Loads an open handover for its own driver, locked. */
  private async forGiver(c: PoolClient, actor: AuthContext, id: string): Promise<HandoverRow> {
    await this.expireStale(c);
    const h = await this.load(c, id, true);
    this.checkGiver(actor, h);
    if (h.status !== 'open') throw apiError(HttpStatus.CONFLICT, 'handover_not_open', 'This handover is no longer open.');
    return h;
  }

  private async tagged(c: PoolClient, epcs: string[], h: HandoverRow) {
    const r = await c.query<{
      epc: string; item_id: string; physical_state: string; on_this_truck: boolean; on_a_truck: boolean; in_handover: 'out' | 'in' | null;
    }>(
      `SELECT t.epc, t.item_id, i.physical_state,
              (i.custody_kind = 'truck' AND i.custody_holder_id = $2 AND EXISTS (
                 SELECT 1 FROM trip_lines x WHERE x.item_id = t.item_id AND x.trip_id = $2
                   AND x.removed_at IS NULL AND x.returned_at IS NULL AND x.delivered_at IS NULL)) AS on_this_truck,
              (i.custody_kind = 'truck' OR EXISTS (
                 SELECT 1 FROM trip_lines x WHERE x.item_id = t.item_id
                   AND x.removed_at IS NULL AND x.returned_at IS NULL AND x.delivered_at IS NULL)) AS on_a_truck,
              (SELECT l.direction FROM handover_lines l WHERE l.handover_id = $3 AND l.item_id = t.item_id AND l.removed_at IS NULL) AS in_handover
       FROM item_tags t JOIN tracked_items i ON i.id = t.item_id
       WHERE t.epc = ANY($1::text[])`,
      [epcs, h.trip_id, h.id],
    );
    return new Map(r.rows.map((x) => [x.epc, x]));
  }

  private async addLines(c: PoolClient, id: string, add: { itemId: string; epc: string }[], direction: 'out' | 'in'): Promise<void> {
    if (add.length === 0) return;
    await c.query(
      `INSERT INTO handover_lines (tenant_id, handover_id, item_id, epc, direction)
       SELECT current_tenant_id(), $1, r.item_id, r.epc, $2 FROM unnest($3::uuid[], $4::text[]) AS r(item_id, epc)`,
      [id, direction, add.map((a) => a.itemId), add.map((a) => a.epc)],
    );
  }

  private async balance(c: PoolClient, id: string): Promise<Balance> {
    const r = await c.query<{ full_out: string; empty_in: string; sold: string }>(
      `SELECT count(*) FILTER (WHERE direction = 'out') AS full_out, count(*) FILTER (WHERE direction = 'in') AS empty_in,
              count(*) FILTER (WHERE direction = 'out' AND sold_outright) AS sold
       FROM handover_lines WHERE handover_id = $1 AND removed_at IS NULL`,
      [id],
    );
    const fullOut = Number(r.rows[0]!.full_out);
    const emptyIn = Number(r.rows[0]!.empty_in);
    const soldOutright = Number(r.rows[0]!.sold);
    return { fullOut, emptyIn, soldOutright, uncovered: uncoveredOf(fullOut, emptyIn, soldOutright) };
  }

  private frozen(h: HandoverRow): Balance {
    const fullOut = h.full_out ?? 0;
    const emptyIn = h.empty_in ?? 0;
    const soldOutright = h.sold_out ?? 0;
    return { fullOut, emptyIn, soldOutright, uncovered: uncoveredOf(fullOut, emptyIn, soldOutright) };
  }

  private summary(h: HandoverRow, balance: Balance) {
    return {
      id: h.id,
      customer: { id: h.customer_id, name: h.customer_name, kind: h.customer_kind },
      giver: { id: h.giver_id, name: h.giver_name },
      status: h.status,
      ref: h.ref,
      openedAt: h.opened_at,
      closedAt: h.closed_at,
      balance,
      owed: h.owed_count ? { count: h.owed_count, dueOn: h.owed_due_on, approvedBy: h.owed_approved_by_name } : null,
      shortfall: h.shortfall,
      disputeNote: h.dispute_note,
    };
  }

  private async detail(c: PoolClient, h: HandoverRow) {
    const lines = await c.query<{ item_id: string; epc: string; direction: 'out' | 'in'; sold_outright: boolean; serial: string | null; size: string }>(
      `SELECT l.item_id, l.epc, l.direction, l.sold_outright, cy.serial, z.name AS size
       FROM handover_lines l JOIN cylinders cy ON cy.item_id = l.item_id JOIN cylinder_sizes z ON z.id = cy.size_id
       WHERE l.handover_id = $1 AND l.removed_at IS NULL ORDER BY l.direction DESC, l.added_at, l.id`,
      [h.id],
    );
    const foreign = await c.query<{ n: string }>('SELECT count(*) AS n FROM handover_foreign_tags WHERE handover_id = $1', [h.id]);
    return {
      ...this.summary(h, h.full_out === null ? await this.balance(c, h.id) : this.frozen(h)),
      trip: { id: h.trip_id, vehicleReg: h.vehicle_reg, depotId: h.depot_id },
      code: h.status === 'awaiting_confirmation' ? { expiresAt: h.code_expires_at, freshCodeLeft: h.codes_sent < 2 } : null,
      foreignTags: Number(foreign.rows[0]!.n),
      lines: lines.rows.map((l) => ({ itemId: l.item_id, epc: l.epc, direction: l.direction, soldOutright: l.sold_outright, cylinder: { serial: l.serial, size: l.size } })),
    };
  }
}
