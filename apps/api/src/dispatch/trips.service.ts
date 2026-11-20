import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { normalizeEpc, type Permission } from '@ilacore/domain';
import type { Pool, PoolClient } from 'pg';
import { canAt, requireAt } from '../access/require-at.js';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import { recordEvent, recordEvents } from '../events/record-event.js';
import type { RequestMeta } from '../http/request.js';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';

/** Most tags accepted in one load or return call (a full truck is well under this). */
export const MAX_TAGS_PER_CALL = 500;

/** Who may see trips at a depot. The trip's own driver always may. */
const VIEW: readonly Permission[] = ['dispatch.scan', 'dispatch.approve_exception', 'route.settle', 'item.view_position'];

/** Something odd about a line that a supervisor must approve before the driver can sign. */
export type LineException = 'not_at_depot' | 'retired_tag' | 'not_full';

export type LoadOutcome =
  | { epc: string; result: 'added'; itemId: string; exception: LineException | null }
  | { epc: string; result: 'already_on_trip'; itemId: string }
  | {
      epc: string;
      result: 'blocked';
      reason: 'not_a_tag' | 'unknown_tag' | 'on_hold' | 'not_usable' | 'on_another_trip';
      itemId?: string;
    };

export type ReturnOutcome =
  | { epc: string; result: 'returned' | 'already_back'; itemId: string }
  | { epc: string; result: 'not_on_trip'; itemId: string; custody: { kind: string; place: string | null } }
  | { epc: string; result: 'not_a_tag' | 'unknown_tag' };

export interface TripSummary {
  id: string;
  depot: { id: string; name: string };
  driver: { id: string; name: string };
  vehicleReg: string;
  status: 'loading' | 'out' | 'cancelled';
  note: string | null;
  openedBy: string;
  openedAt: Date;
  signedAt: Date | null;
  counts: { loaded: number; needsApproval: number; back: number; stillOut: number };
}

export interface TripLine {
  itemId: string;
  epc: string;
  cylinder: { serial: string | null; size: string };
  physicalState: 'empty' | 'full';
  exception: LineException | null;
  approvedBy: string | null;
  addedBy: string;
  addedAt: Date;
  removedAt: Date | null;
  returnedAt: Date | null;
  returnedState: 'empty' | 'full' | null;
}

interface TripRow {
  id: string;
  depot_id: string;
  depot_name: string;
  driver_id: string;
  driver_name: string;
  vehicle_reg: string;
  status: 'loading' | 'out' | 'cancelled';
  note: string | null;
  opened_by: string;
  opened_by_name: string;
  opened_at: Date;
  signed_at: Date | null;
  loaded: string;
  needs_approval: string;
  back: string;
}

const TRIPS = `
  SELECT tr.id, tr.depot_id, l.name AS depot_name, tr.driver_id, d.display_name AS driver_name, tr.vehicle_reg,
         tr.status, tr.note, tr.opened_by, o.display_name AS opened_by_name, tr.opened_at, tr.signed_at,
         (SELECT count(*) FROM trip_lines x WHERE x.trip_id = tr.id AND x.removed_at IS NULL) AS loaded,
         (SELECT count(*) FROM trip_lines x WHERE x.trip_id = tr.id AND x.removed_at IS NULL
            AND x.exception IS NOT NULL AND x.approved_at IS NULL) AS needs_approval,
         (SELECT count(*) FROM trip_lines x WHERE x.trip_id = tr.id AND x.returned_at IS NOT NULL) AS back
  FROM trips tr
  JOIN locations l ON l.id = tr.depot_id
  JOIN users d ON d.id = tr.driver_id
  JOIN users o ON o.id = tr.opened_by`;

function summary(r: TripRow): TripSummary {
  const loaded = Number(r.loaded);
  const back = Number(r.back);
  return {
    id: r.id,
    depot: { id: r.depot_id, name: r.depot_name },
    driver: { id: r.driver_id, name: r.driver_name },
    vehicleReg: r.vehicle_reg,
    status: r.status,
    note: r.note,
    openedBy: r.opened_by_name,
    openedAt: r.opened_at,
    signedAt: r.signed_at,
    counts: { loaded, needsApproval: Number(r.needs_approval), back, stillOut: r.status === 'out' ? loaded - back : 0 },
  };
}

/** Number plates are written many ways ("KCA 123A", "kca-123a"); they are stored as KCA123A. */
export function normalizeVehicleReg(raw: string): string | null {
  const reg = raw.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{2,12}$/.test(reg) ? reg : null;
}

/** The tags in a call, cleaned: each valid one once, in the order sent; the others reported as not tags. */
function cleanTags(raw: readonly string[]): { epcs: string[]; invalid: string[] } {
  if (raw.length === 0 || raw.length > MAX_TAGS_PER_CALL) {
    throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', `Send between 1 and ${MAX_TAGS_PER_CALL} tags.`);
  }
  const epcs: string[] = [];
  const invalid: string[] = [];
  for (const r of raw) {
    const epc = normalizeEpc(r);
    if (!epc) invalid.push(r);
    else if (!epcs.includes(epc)) epcs.push(epc);
  }
  return { epcs, invalid };
}

const deviceOf = (actor: AuthContext) => (actor.deviceId ? { deviceId: actor.deviceId } : {});

/**
 * Trips: a truck leaving a depot with a driver. The loader builds the load, a supervisor approves anything odd,
 * the driver signs for the whole load (custody moves to the truck), and returning cylinders are scanned back in.
 */
@Injectable()
export class TripsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Drivers who may take a truck out of this depot (the guard checked dispatch.scan there). */
  async drivers(actor: AuthContext, depotId: string): Promise<{ id: string; name: string }[]> {
    return withTenant(this.pool, actor.tenantId, (c) => this.driversAt(c, depotId));
  }

  /** Opens a trip for loading (the guard checked dispatch.scan at the depot). */
  async open(
    actor: AuthContext,
    input: { depotId: string; driverId: string; vehicleReg: string; note?: string | undefined },
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    const vehicleReg = normalizeVehicleReg(input.vehicleReg);
    const note = input.note?.trim() || null;
    const fields = [...(vehicleReg ? [] : ['vehicleReg']), ...(note && note.length > 200 ? ['note'] : [])];
    if (fields.length > 0) throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', 'Check the trip details.', { fields });

    return withTenant(this.pool, actor.tenantId, async (c) => {
      const depot = await c.query<{ kind: string }>('SELECT kind FROM locations WHERE id = $1', [input.depotId]);
      if (depot.rows[0]?.kind !== 'depot') throw apiError(HttpStatus.BAD_REQUEST, 'not_a_depot', 'Trips leave from a depot.');
      const drivers = await this.driversAt(c, input.depotId);
      if (!drivers.some((d) => d.id === input.driverId)) {
        throw apiError(HttpStatus.BAD_REQUEST, 'not_a_driver', 'That person is not a driver at this depot.', { fields: ['driverId'] });
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO trips (tenant_id, depot_id, driver_id, vehicle_reg, note, opened_by)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5) RETURNING id`,
        [input.depotId, input.driverId, vehicleReg, note, actor.userId],
      );
      const id = r.rows[0]!.id;
      await recordEvent(c, {
        type: 'trip.opened',
        aggregateType: 'trip',
        aggregateId: id,
        payload: { depotId: input.depotId, driverId: input.driverId, vehicleReg },
        actorId: actor.userId,
        ...deviceOf(actor),
        occurredAt: new Date(),
      });
      await recordAudit(c, { action: 'trip.opened', actorId: actor.userId, deviceId: actor.deviceId ?? undefined, targetType: 'trip', targetId: id, ...meta });
      return { id };
    });
  }

  async list(actor: AuthContext, filters: { depotId?: string | undefined; status?: string | undefined }): Promise<TripSummary[]> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const r = await c.query<TripRow>(
        `${TRIPS}
         WHERE ($1::uuid IS NULL OR tr.depot_id = $1) AND ($2::text IS NULL OR tr.status = $2)
         ORDER BY tr.opened_at DESC LIMIT 200`,
        [filters.depotId ?? null, filters.status ?? null],
      );
      return r.rows.filter((t) => t.driver_id === actor.userId || canAt(actor, VIEW, t.depot_id)).map(summary);
    });
  }

  async get(actor: AuthContext, tripId: string): Promise<TripSummary & { lines: TripLine[] }> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const trip = await this.load(c, tripId);
      if (trip.driver_id !== actor.userId) requireAt(actor, VIEW, trip.depot_id);
      const lines = await c.query<{
        item_id: string; epc: string; serial: string | null; size: string; physical_state: 'empty' | 'full';
        exception: LineException | null; approved_by: string | null; added_by: string; added_at: Date;
        removed_at: Date | null; returned_at: Date | null; returned_state: 'empty' | 'full' | null;
      }>(
        `SELECT x.item_id, x.epc, c.serial, z.name AS size, x.physical_state, x.exception, ap.display_name AS approved_by,
                ad.display_name AS added_by, x.added_at, x.removed_at, x.returned_at, x.returned_state
         FROM trip_lines x
         JOIN cylinders c ON c.item_id = x.item_id
         JOIN cylinder_sizes z ON z.id = c.size_id
         JOIN users ad ON ad.id = x.added_by
         LEFT JOIN users ap ON ap.id = x.approved_by
         WHERE x.trip_id = $1
         ORDER BY x.removed_at NULLS FIRST, (x.exception IS NOT NULL AND x.approved_at IS NULL) DESC, x.added_at, x.id`,
        [tripId],
      );
      return {
        ...summary(trip),
        lines: lines.rows.map((l) => ({
          itemId: l.item_id,
          epc: l.epc,
          cylinder: { serial: l.serial, size: l.size },
          physicalState: l.physical_state,
          exception: l.exception,
          approvedBy: l.approved_by,
          addedBy: l.added_by,
          addedAt: l.added_at,
          removedAt: l.removed_at,
          returnedAt: l.returned_at,
          returnedState: l.returned_state,
        })),
      };
    });
  }

  /**
   * Adds scanned cylinders to the load. Each tag gets an outcome. Only what must never go out is refused
   * (on hold, damaged, already on another truck); odd but possible lines need a supervisor's approval.
   */
  async addToLoad(actor: AuthContext, tripId: string, rawEpcs: readonly string[]): Promise<{ outcomes: LoadOutcome[] }> {
    const { epcs, invalid } = cleanTags(rawEpcs);
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const trip = await this.load(c, tripId, true);
      requireAt(actor, ['dispatch.scan'], trip.depot_id);
      if (trip.status !== 'loading') throw apiError(HttpStatus.CONFLICT, 'trip_not_loading', 'This trip is no longer loading.');
      await this.refuseIfApprover(c, actor, tripId);

      const found = await c.query<{
        epc: string; item_id: string; retired: boolean; custody_kind: string; custody_location_id: string | null;
        physical_state: string; safety_hold: string; live_trip_id: string | null;
      }>(
        `SELECT t.epc, t.item_id, t.retired_at IS NOT NULL AS retired, i.custody_kind, i.custody_location_id,
                i.physical_state, c.safety_hold, live.trip_id AS live_trip_id
         FROM item_tags t
         JOIN tracked_items i ON i.id = t.item_id
         JOIN cylinders c ON c.item_id = t.item_id
         LEFT JOIN trip_lines live ON live.item_id = t.item_id AND live.removed_at IS NULL AND live.returned_at IS NULL
         WHERE t.epc = ANY($1::text[])
         FOR UPDATE OF i`,
        [epcs],
      );
      const byEpc = new Map(found.rows.map((r) => [r.epc, r]));
      const outcomes: LoadOutcome[] = invalid.map((epc) => ({ epc, result: 'blocked', reason: 'not_a_tag' }));
      const add: { itemId: string; epc: string; physical: string; exception: LineException | null }[] = [];

      for (const epc of epcs) {
        const r = byEpc.get(epc);
        if (!r) {
          outcomes.push({ epc, result: 'blocked', reason: 'unknown_tag' });
          continue;
        }
        const itemId = r.item_id;
        // A cylinder read twice (old and new tag in one sweep) is one line.
        if (r.live_trip_id === tripId || add.some((a) => a.itemId === itemId)) {
          outcomes.push({ epc, result: 'already_on_trip', itemId });
        } else if (r.live_trip_id) {
          outcomes.push({ epc, result: 'blocked', reason: 'on_another_trip', itemId });
        } else if (r.safety_hold !== 'none') {
          outcomes.push({ epc, result: 'blocked', reason: 'on_hold', itemId });
        } else if (r.physical_state !== 'full' && r.physical_state !== 'empty') {
          outcomes.push({ epc, result: 'blocked', reason: 'not_usable', itemId });
        } else {
          const exception: LineException | null =
            r.custody_kind !== 'depot' || r.custody_location_id !== trip.depot_id
              ? 'not_at_depot'
              : r.retired
                ? 'retired_tag'
                : r.physical_state !== 'full'
                  ? 'not_full'
                  : null;
          add.push({ itemId, epc, physical: r.physical_state, exception });
          outcomes.push({ epc, result: 'added', itemId, exception });
        }
      }

      if (add.length > 0) {
        await c.query(
          `INSERT INTO trip_lines (tenant_id, trip_id, item_id, epc, physical_state, exception, added_by)
           SELECT current_tenant_id(), $1, r.item_id, r.epc, r.physical, r.exception, $2
           FROM unnest($3::uuid[], $4::text[], $5::text[], $6::text[]) AS r(item_id, epc, physical, exception)`,
          [tripId, actor.userId, add.map((a) => a.itemId), add.map((a) => a.epc), add.map((a) => a.physical), add.map((a) => a.exception)],
        );
      }
      return { outcomes };
    });
  }

  /** Takes a cylinder off the load before the driver signs. */
  async removeFromLoad(actor: AuthContext, tripId: string, itemId: string): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      const trip = await this.load(c, tripId, true);
      requireAt(actor, ['dispatch.scan'], trip.depot_id);
      if (trip.status !== 'loading') throw apiError(HttpStatus.CONFLICT, 'trip_not_loading', 'This trip is no longer loading.');
      await this.refuseIfApprover(c, actor, tripId);
      const r = await c.query(
        `UPDATE trip_lines SET removed_at = now(), removed_by = $3
         WHERE trip_id = $1 AND item_id = $2 AND removed_at IS NULL AND returned_at IS NULL`,
        [tripId, itemId, actor.userId],
      );
      if (r.rowCount !== 1) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'That cylinder is not on this load.');
    });
  }

  /**
   * A supervisor approves an odd line. Separation of duties: someone who opened the trip or scanned any of
   * its load can't approve its exceptions.
   */
  async approve(actor: AuthContext, tripId: string, itemId: string, meta: RequestMeta): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      const trip = await this.load(c, tripId, true);
      requireAt(actor, ['dispatch.approve_exception'], trip.depot_id);
      if (trip.status !== 'loading') throw apiError(HttpStatus.CONFLICT, 'trip_not_loading', 'This trip is no longer loading.');
      const loadedBySelf = await c.query('SELECT 1 FROM trip_lines WHERE trip_id = $1 AND added_by = $2 LIMIT 1', [tripId, actor.userId]);
      if (trip.opened_by === actor.userId || (loadedBySelf.rowCount ?? 0) > 0) {
        throw apiError(HttpStatus.FORBIDDEN, 'separation_of_duties', 'Someone who loaded this truck can\'t approve its exceptions.');
      }
      const r = await c.query<{ exception: string }>(
        `UPDATE trip_lines SET approved_at = now(), approved_by = $3
         WHERE trip_id = $1 AND item_id = $2 AND removed_at IS NULL AND exception IS NOT NULL AND approved_at IS NULL
         RETURNING exception`,
        [tripId, itemId, actor.userId],
      );
      if (r.rowCount !== 1) throw apiError(HttpStatus.CONFLICT, 'nothing_to_approve', 'There is nothing to approve on that line.');
      await recordAudit(c, {
        action: 'dispatch.exception_approved',
        actorId: actor.userId,
        deviceId: actor.deviceId ?? undefined,
        targetType: 'trip',
        targetId: tripId,
        details: { itemId, exception: r.rows[0]!.exception },
        ...meta,
      });
    });
  }

  /**
   * The driver signs for the whole load. Custody of every cylinder moves to the truck and the trip goes out.
   * Only the trip's own driver can sign, and only when nothing is waiting for approval.
   */
  async sign(actor: AuthContext, tripId: string, meta: RequestMeta): Promise<{ loaded: number }> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const trip = await this.load(c, tripId, true);
      if (trip.driver_id !== actor.userId) throw apiError(HttpStatus.FORBIDDEN, 'not_your_trip', 'Only the trip\'s driver can sign for the load.');
      requireAt(actor, ['handover.perform'], trip.depot_id);
      if (trip.status !== 'loading') throw apiError(HttpStatus.CONFLICT, 'trip_not_loading', 'This trip is no longer loading.');

      const lines = await c.query<{
        item_id: string; physical_state: string; exception: string | null; approved: boolean; safety_hold: string;
        custody_kind: string; custody_location_id: string | null;
      }>(
        `SELECT x.item_id, x.physical_state, x.exception, x.approved_at IS NOT NULL AS approved, c.safety_hold,
                i.custody_kind, i.custody_location_id
         FROM trip_lines x
         JOIN tracked_items i ON i.id = x.item_id
         JOIN cylinders c ON c.item_id = x.item_id
         WHERE x.trip_id = $1 AND x.removed_at IS NULL
         FOR UPDATE OF i`,
        [tripId],
      );
      if (lines.rows.length === 0) throw apiError(HttpStatus.CONFLICT, 'empty_load', 'Nothing is loaded yet.');
      if (lines.rows.some((l) => l.exception && !l.approved)) {
        throw apiError(HttpStatus.CONFLICT, 'needs_approval', 'A supervisor must approve the odd lines first.');
      }
      // A hold placed after loading still stops it.
      if (lines.rows.some((l) => l.safety_hold !== 'none')) {
        throw apiError(HttpStatus.CONFLICT, 'on_hold', 'A cylinder on this load has been put on hold. Take it off first.');
      }

      const ids = lines.rows.map((l) => l.item_id);
      await c.query(
        `UPDATE tracked_items SET custody_kind = 'truck', custody_location_id = NULL, custody_holder_id = $2, updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [ids, tripId],
      );
      await c.query(`UPDATE trips SET status = 'out', signed_at = now() WHERE id = $1`, [tripId]);
      const now = new Date();
      await recordEvents(
        c,
        lines.rows.map((l) => ({
          type: 'item.dispatched',
          aggregateType: 'tracked_item',
          aggregateId: l.item_id,
          payload: {
            tripId,
            depotId: trip.depot_id,
            vehicleReg: trip.vehicle_reg,
            driverId: trip.driver_id,
            from: { kind: l.custody_kind, locationId: l.custody_location_id },
            physicalState: l.physical_state,
            exception: l.exception,
          },
          actorId: actor.userId,
          ...deviceOf(actor),
          occurredAt: now,
        })),
      );
      await recordEvent(c, {
        type: 'trip.signed',
        aggregateType: 'trip',
        aggregateId: tripId,
        payload: { loaded: ids.length },
        actorId: actor.userId,
        ...deviceOf(actor),
        occurredAt: now,
      });
      await recordAudit(c, { action: 'trip.signed', actorId: actor.userId, deviceId: actor.deviceId ?? undefined, targetType: 'trip', targetId: tripId, details: { loaded: ids.length }, ...meta });
      return { loaded: ids.length };
    });
  }

  /** Abandons a trip that hasn't gone out. Its load is taken off; nothing moved, so nothing moves back. */
  async cancel(actor: AuthContext, tripId: string, meta: RequestMeta): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      const trip = await this.load(c, tripId, true);
      requireAt(actor, ['dispatch.scan', 'dispatch.approve_exception'], trip.depot_id);
      if (trip.status !== 'loading') throw apiError(HttpStatus.CONFLICT, 'trip_not_loading', 'Only a trip still loading can be cancelled.');
      await c.query(
        `UPDATE trip_lines SET removed_at = now(), removed_by = $2 WHERE trip_id = $1 AND removed_at IS NULL`,
        [tripId, actor.userId],
      );
      await c.query(`UPDATE trips SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2 WHERE id = $1`, [tripId, actor.userId]);
      await recordEvent(c, { type: 'trip.cancelled', aggregateType: 'trip', aggregateId: tripId, payload: {}, actorId: actor.userId, ...deviceOf(actor), occurredAt: new Date() });
      await recordAudit(c, { action: 'trip.cancelled', actorId: actor.userId, deviceId: actor.deviceId ?? undefined, targetType: 'trip', targetId: tripId, ...meta });
    });
  }

  /**
   * Scans returning cylinders back into the trip's depot, as full (not delivered) or empty. Only cylinders still on
   * this truck move; anything else is reported with where the system thinks it is, and left alone.
   */
  async returnToDepot(
    actor: AuthContext,
    tripId: string,
    rawEpcs: readonly string[],
    physicalState: 'empty' | 'full',
  ): Promise<{ outcomes: ReturnOutcome[] }> {
    const { epcs, invalid } = cleanTags(rawEpcs);
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const trip = await this.load(c, tripId, true);
      requireAt(actor, ['dispatch.scan'], trip.depot_id);
      if (trip.status !== 'out') throw apiError(HttpStatus.CONFLICT, 'trip_not_out', 'This trip has not gone out.');

      const found = await c.query<{
        epc: string; item_id: string; custody_kind: string; custody_holder_id: string | null; place: string | null;
        live_here: boolean; back_here: boolean;
      }>(
        `SELECT t.epc, t.item_id, i.custody_kind, i.custody_holder_id, coalesce(l.name, ot.vehicle_reg) AS place,
                EXISTS (SELECT 1 FROM trip_lines x WHERE x.trip_id = $2 AND x.item_id = t.item_id
                          AND x.removed_at IS NULL AND x.returned_at IS NULL) AS live_here,
                EXISTS (SELECT 1 FROM trip_lines x WHERE x.trip_id = $2 AND x.item_id = t.item_id
                          AND x.returned_at IS NOT NULL) AS back_here
         FROM item_tags t
         JOIN tracked_items i ON i.id = t.item_id
         LEFT JOIN locations l ON l.id = i.custody_location_id
         LEFT JOIN trips ot ON i.custody_kind = 'truck' AND ot.id = i.custody_holder_id
         WHERE t.epc = ANY($1::text[])
         FOR UPDATE OF i`,
        [epcs, tripId],
      );
      const byEpc = new Map(found.rows.map((r) => [r.epc, r]));
      const outcomes: ReturnOutcome[] = invalid.map((epc) => ({ epc, result: 'not_a_tag' }));
      const back: string[] = [];
      for (const epc of epcs) {
        const r = byEpc.get(epc);
        if (!r) outcomes.push({ epc, result: 'unknown_tag' });
        else if (back.includes(r.item_id) || (!r.live_here && r.back_here)) outcomes.push({ epc, result: 'already_back', itemId: r.item_id });
        else if (r.live_here && r.custody_kind === 'truck' && r.custody_holder_id === tripId) {
          back.push(r.item_id);
          outcomes.push({ epc, result: 'returned', itemId: r.item_id });
        } else outcomes.push({ epc, result: 'not_on_trip', itemId: r.item_id, custody: { kind: r.custody_kind, place: r.place } });
      }

      if (back.length > 0) {
        await c.query(
          `UPDATE tracked_items SET custody_kind = 'depot', custody_location_id = $2, custody_holder_id = NULL,
                  physical_state = $3, updated_at = now()
           WHERE id = ANY($1::uuid[])`,
          [back, trip.depot_id, physicalState],
        );
        await c.query(
          `UPDATE trip_lines SET returned_at = now(), returned_by = $3, returned_state = $4
           WHERE trip_id = $1 AND item_id = ANY($2::uuid[]) AND removed_at IS NULL AND returned_at IS NULL`,
          [tripId, back, actor.userId, physicalState],
        );
        const now = new Date();
        await recordEvents(
          c,
          back.map((itemId) => ({
            type: 'item.returned',
            aggregateType: 'tracked_item',
            aggregateId: itemId,
            payload: { tripId, depotId: trip.depot_id, vehicleReg: trip.vehicle_reg, physicalState },
            actorId: actor.userId,
            ...deviceOf(actor),
            occurredAt: now,
          })),
        );
      }
      return { outcomes };
    });
  }

  private async driversAt(c: PoolClient, depotId: string): Promise<{ id: string; name: string }[]> {
    const r = await c.query<{ id: string; name: string }>(
      `SELECT DISTINCT u.id, u.display_name AS name FROM users u
       JOIN role_assignments a ON a.user_id = u.id AND a.role = 'driver' AND a.revoked_at IS NULL
       WHERE u.status = 'active' AND (a.location_id IS NULL OR a.location_id = $1)
       ORDER BY name`,
      [depotId],
    );
    return r.rows;
  }

  private async load(c: PoolClient, tripId: string, lock = false): Promise<TripRow> {
    const r = await c.query<TripRow>(`${TRIPS} WHERE tr.id = $1${lock ? ' FOR UPDATE OF tr' : ''}`, [tripId]);
    const trip = r.rows[0];
    if (!trip) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such trip.');
    return trip;
  }

  /** The other half of separation of duties: whoever approved an exception on this trip can't change its load. */
  private async refuseIfApprover(c: PoolClient, actor: AuthContext, tripId: string): Promise<void> {
    const r = await c.query('SELECT 1 FROM trip_lines WHERE trip_id = $1 AND approved_by = $2 LIMIT 1', [tripId, actor.userId]);
    if ((r.rowCount ?? 0) > 0) {
      throw apiError(HttpStatus.FORBIDDEN, 'separation_of_duties', 'Someone who approved this load\'s exceptions can\'t change it.');
    }
  }
}
