import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  isIsoDate,
  normalizeEpc,
  normalizeSerial,
  RETEST_WARNING_DAYS,
  todayInKenya,
  type Permission,
  type TagRetireReason,
} from '@ilacore/domain';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { canAt, requireAt } from '../access/require-at.js';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import { recordEvent, recordEvents } from '../events/record-event.js';
import type { RequestMeta } from '../http/request.js';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';

export const MAX_CYLINDERS_PER_IMPORT = 500;

/** One cylinder to register, as typed or imported. */
export interface NewCylinder {
  sizeId: string;
  epc: string;
  serial?: string | undefined;
  manufacturer?: string | undefined;
  manufacturedOn?: string | undefined;
  tareKg?: number | undefined;
  lastTestOn?: string | undefined;
  nextTestDue?: string | undefined;
  /** Existing stock may already be full. Default empty. */
  physicalState?: 'empty' | 'full' | undefined;
}

/** A row that can't be registered, and why (field names, or a reason code). */
export interface RowProblem {
  row: number;
  fields: string[];
  reason?: 'tag_in_use' | 'tag_retired' | 'serial_in_use' | 'duplicate_in_list' | 'unknown_size';
}

export interface CylinderSummary {
  id: string;
  epc: string | null;
  serial: string | null;
  manufacturer: string | null;
  size: { id: string; name: string };
  physicalState: string;
  custody: { kind: string; locationId: string | null; locationName: string | null };
  lastTestOn: string | null;
  /** The effective due date: recorded, or last test + interval. Null when unknown. */
  nextTestDue: string | null;
  testDateKnown: boolean;
  safetyHold: string;
  safety: string;
}

export interface CylinderDetail extends CylinderSummary {
  manufacturedOn: string | null;
  tareKg: number | null;
  /** The due date as recorded (not derived). */
  recordedNextTestDue: string | null;
  registeredAt: Date;
  tags: { epc: string; attachedAt: Date; retiredAt: Date | null; retireReason: string | null }[];
  history: { type: string; occurredAt: Date; actor: string | null; payload: Record<string, unknown> }[];
  /** Only present for investigation roles. */
  security?: string;
}

export interface CylinderFilters {
  locationId?: string | undefined;
  sizeId?: string | undefined;
  physicalState?: string | undefined;
  safety?: string | undefined;
  search?: string | undefined;
  limit: number;
  offset: number;
}

const VIEW: readonly Permission[] = ['item.view_position', 'item.register'];

/*
 * The base query. Safety is worked out here (not stored) because time changes it: the due date is the
 * recorded one, or the last test plus the organisation's interval (PostgreSQL clamps month ends the same
 * way as addMonths in @ilacore/domain). $1 is today's date in Kenya, $2 the warning window in days.
 * Keep this in step with safetyState() in @ilacore/domain; the integration tests compare the two.
 */
const BASE = `
  SELECT i.id, i.physical_state, i.custody_kind, i.custody_location_id, l.name AS location_name,
         i.registered_at, c.serial, c.manufacturer, c.size_id, z.name AS size_name, c.tare_kg, c.safety_hold,
         to_char(c.manufactured_on, 'YYYY-MM-DD') AS manufactured_on,
         to_char(c.last_test_on, 'YYYY-MM-DD') AS last_test_on,
         to_char(c.next_test_due, 'YYYY-MM-DD') AS recorded_next_test_due,
         to_char(d.due, 'YYYY-MM-DD') AS next_test_due,
         sf.safety, t.epc
  FROM tracked_items i
  JOIN cylinders c ON c.item_id = i.id
  JOIN cylinder_sizes z ON z.id = c.size_id
  LEFT JOIN locations l ON l.id = i.custody_location_id
  LEFT JOIN item_tags t ON t.item_id = i.id AND t.retired_at IS NULL
  LEFT JOIN tenant_settings ts ON true
  CROSS JOIN LATERAL (
    SELECT coalesce(c.next_test_due, (c.last_test_on + make_interval(months => ts.retest_interval_months))::date) AS due
  ) d
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN c.safety_hold = 'condemned' THEN 'condemned'
      WHEN c.safety_hold = 'quarantined' THEN 'quarantined'
      WHEN d.due IS NULL THEN 'retest_due'
      WHEN d.due < $1::date THEN 'retest_overdue'
      WHEN d.due <= $1::date + $2::integer THEN 'retest_due'
      ELSE 'eligible'
    END AS safety
  ) sf`;

interface BaseRow {
  id: string;
  physical_state: string;
  custody_kind: string;
  custody_location_id: string | null;
  location_name: string | null;
  registered_at: Date;
  serial: string | null;
  manufacturer: string | null;
  size_id: string;
  size_name: string;
  tare_kg: string | null;
  safety_hold: string;
  manufactured_on: string | null;
  last_test_on: string | null;
  recorded_next_test_due: string | null;
  next_test_due: string | null;
  safety: string;
  epc: string | null;
}

function summary(r: BaseRow): CylinderSummary {
  return {
    id: r.id,
    epc: r.epc,
    serial: r.serial,
    manufacturer: r.manufacturer,
    size: { id: r.size_id, name: r.size_name },
    physicalState: r.physical_state,
    custody: { kind: r.custody_kind, locationId: r.custody_location_id, locationName: r.location_name },
    lastTestOn: r.last_test_on,
    nextTestDue: r.next_test_due,
    testDateKnown: r.next_test_due !== null,
    safetyHold: r.safety_hold,
    safety: r.safety,
  };
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

interface CleanCylinder {
  id: string;
  sizeId: string;
  epc: string;
  serial: string | null;
  manufacturer: string | null;
  manufacturedOn: string | null;
  tareKg: number | null;
  lastTestOn: string | null;
  nextTestDue: string | null;
  physicalState: 'empty' | 'full';
}

/** Checks one row on its own (no database). Returns the cleaned row or the fields that are wrong. */
function cleanRow(input: NewCylinder, today: string): { row: CleanCylinder } | { fields: string[] } {
  const fields: string[] = [];
  const epc = normalizeEpc(input.epc ?? '');
  if (!epc) fields.push('epc');
  if (!isUuid(input.sizeId ?? '')) fields.push('sizeId');
  const serialRaw = input.serial?.trim() ? input.serial : undefined;
  const serial = serialRaw === undefined ? null : normalizeSerial(serialRaw);
  if (serialRaw !== undefined && serial === null) fields.push('serial');
  const manufacturer = input.manufacturer?.trim() ? input.manufacturer.trim().replace(/\s+/g, ' ') : null;
  if (manufacturer && manufacturer.length > 80) fields.push('manufacturer');

  const date = (name: 'manufacturedOn' | 'lastTestOn' | 'nextTestDue'): string | null => {
    const v = input[name]?.trim();
    if (!v) return null;
    if (!isIsoDate(v)) {
      fields.push(name);
      return null;
    }
    return v;
  };
  const manufacturedOn = date('manufacturedOn');
  const lastTestOn = date('lastTestOn');
  const nextTestDue = date('nextTestDue');
  if (manufacturedOn && manufacturedOn > today) fields.push('manufacturedOn');
  if (lastTestOn && lastTestOn > today) fields.push('lastTestOn');
  if (lastTestOn && manufacturedOn && lastTestOn < manufacturedOn) fields.push('lastTestOn');
  if (nextTestDue && lastTestOn && nextTestDue <= lastTestOn) fields.push('nextTestDue');

  const tare = input.tareKg;
  if (tare !== undefined && (!Number.isFinite(tare) || tare <= 0 || tare > 1000 || Math.abs(Math.round(tare * 100) - tare * 100) > 1e-9)) {
    fields.push('tareKg');
  }
  const physicalState = input.physicalState ?? 'empty';
  if (physicalState !== 'empty' && physicalState !== 'full') fields.push('physicalState');

  if (fields.length > 0) return { fields: [...new Set(fields)] };
  return {
    row: {
      id: randomUUID(),
      sizeId: input.sizeId,
      epc: epc!,
      serial,
      manufacturer,
      manufacturedOn,
      tareKg: tare ?? null,
      lastTestOn,
      nextTestDue,
      physicalState,
    },
  };
}

const serialKey = (manufacturer: string | null, serial: string) => `${(manufacturer ?? '').toLowerCase()}|${serial}`;

/** Cylinders as tracked items: registration, the register, a cylinder's page and tag replacement. */
@Injectable()
export class CylindersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Registers cylinders at a location, all or nothing. Every row is checked first; if any is wrong,
   * nothing is saved and every problem is reported by row number (0-based).
   */
  async register(
    actor: AuthContext,
    locationId: string,
    rows: readonly NewCylinder[],
    meta: RequestMeta,
  ): Promise<{ ids: string[] }> {
    if (rows.length === 0 || rows.length > MAX_CYLINDERS_PER_IMPORT) {
      throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', `Send between 1 and ${MAX_CYLINDERS_PER_IMPORT} cylinders.`);
    }
    const today = todayInKenya();
    const problems: RowProblem[] = [];
    const clean: CleanCylinder[] = [];
    rows.forEach((input, row) => {
      const result = cleanRow(input, today);
      if ('fields' in result) problems.push({ row, fields: result.fields });
      else clean.push(result.row);
    });
    if (problems.length > 0) throw rowsError(problems);

    // Duplicates inside the list itself.
    const seenEpc = new Map<string, number>();
    const seenSerial = new Map<string, number>();
    clean.forEach((c, row) => {
      if (seenEpc.has(c.epc)) problems.push({ row, fields: ['epc'], reason: 'duplicate_in_list' });
      else seenEpc.set(c.epc, row);
      if (c.serial) {
        const key = serialKey(c.manufacturer, c.serial);
        if (seenSerial.has(key)) problems.push({ row, fields: ['serial'], reason: 'duplicate_in_list' });
        else seenSerial.set(key, row);
      }
    });
    if (problems.length > 0) throw rowsError(problems);

    try {
      return await withTenant(this.pool, actor.tenantId, async (c) => {
        const loc = await c.query('SELECT 1 FROM locations WHERE id = $1', [locationId]);
        if (loc.rowCount !== 1) throw apiError(HttpStatus.BAD_REQUEST, 'unknown_location', 'There is no such location.');
        await this.checkAgainstRecords(c, clean, problems);
        if (problems.length > 0) throw rowsError(problems);
        await this.insert(c, actor, locationId, clean);
        await recordAudit(c, {
          action: 'cylinders.registered',
          actorId: actor.userId,
          deviceId: actor.deviceId ?? undefined,
          targetType: 'location',
          targetId: locationId,
          details: { count: clean.length },
          ...meta,
        });
        return { ids: clean.map((r) => r.id) };
      });
    } catch (error) {
      // Two people registering the same tag at the same moment: the database has the last word.
      if ((error as { code?: string }).code === '23505') {
        throw apiError(HttpStatus.CONFLICT, 'conflict', 'A tag or serial was registered by someone else just now. Try again.');
      }
      throw error;
    }
  }

  private async checkAgainstRecords(c: PoolClient, rows: CleanCylinder[], problems: RowProblem[]): Promise<void> {
    const sizes = await c.query<{ id: string }>('SELECT id FROM cylinder_sizes WHERE retired_at IS NULL');
    const activeSizes = new Set(sizes.rows.map((s) => s.id));
    const tags = await c.query<{ epc: string; retired: boolean }>(
      'SELECT epc, retired_at IS NOT NULL AS retired FROM item_tags WHERE epc = ANY($1::text[])',
      [rows.map((r) => r.epc)],
    );
    const knownTags = new Map(tags.rows.map((t) => [t.epc, t.retired]));
    const withSerial = rows.filter((r) => r.serial);
    const serials = withSerial.length
      ? await c.query<{ manufacturer: string | null; serial: string }>(
          'SELECT manufacturer, serial FROM cylinders WHERE serial = ANY($1::text[])',
          [withSerial.map((r) => r.serial)],
        )
      : { rows: [] };
    const knownSerials = new Set(serials.rows.map((s) => serialKey(s.manufacturer?.trim() ?? null, s.serial)));

    rows.forEach((r, row) => {
      if (!activeSizes.has(r.sizeId)) problems.push({ row, fields: ['sizeId'], reason: 'unknown_size' });
      const retired = knownTags.get(r.epc);
      if (retired !== undefined) problems.push({ row, fields: ['epc'], reason: retired ? 'tag_retired' : 'tag_in_use' });
      if (r.serial && knownSerials.has(serialKey(r.manufacturer, r.serial))) {
        problems.push({ row, fields: ['serial'], reason: 'serial_in_use' });
      }
    });
  }

  private async insert(c: PoolClient, actor: AuthContext, locationId: string, rows: CleanCylinder[]): Promise<void> {
    const ids = rows.map((r) => r.id);
    await c.query(
      `INSERT INTO tracked_items (id, tenant_id, item_type, physical_state, custody_kind, custody_location_id, registered_by)
       SELECT r.id, current_tenant_id(), 'cylinder', r.physical, 'depot', $3, $4
       FROM unnest($1::uuid[], $2::text[]) AS r(id, physical)`,
      [ids, rows.map((r) => r.physicalState), locationId, actor.userId],
    );
    await c.query(
      `INSERT INTO item_security (item_id, tenant_id) SELECT id, current_tenant_id() FROM unnest($1::uuid[]) AS id`,
      [ids],
    );
    await c.query(
      `INSERT INTO cylinders (item_id, tenant_id, size_id, serial, manufacturer, manufactured_on, tare_kg, last_test_on, next_test_due)
       SELECT r.id, current_tenant_id(), r.size_id, r.serial, r.manufacturer, r.made::date, r.tare, r.tested::date, r.due::date
       FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::text[], $8::text[])
         AS r(id, size_id, serial, manufacturer, made, tare, tested, due)`,
      [
        ids,
        rows.map((r) => r.sizeId),
        rows.map((r) => r.serial),
        rows.map((r) => r.manufacturer),
        rows.map((r) => r.manufacturedOn),
        rows.map((r) => r.tareKg),
        rows.map((r) => r.lastTestOn),
        rows.map((r) => r.nextTestDue),
      ],
    );
    await c.query(
      `INSERT INTO item_tags (tenant_id, epc, item_id, attached_by)
       SELECT current_tenant_id(), r.epc, r.id, $3 FROM unnest($1::uuid[], $2::text[]) AS r(id, epc)`,
      [ids, rows.map((r) => r.epc), actor.userId],
    );
    const now = new Date();
    await recordEvents(
      c,
      rows.map((r) => ({
        type: 'item.registered',
        aggregateType: 'tracked_item',
        aggregateId: r.id,
        payload: {
          itemType: 'cylinder',
          epc: r.epc,
          sizeId: r.sizeId,
          serial: r.serial,
          physicalState: r.physicalState,
          custody: { kind: 'depot', locationId },
        },
        actorId: actor.userId,
        ...(actor.deviceId ? { deviceId: actor.deviceId } : {}),
        occurredAt: now,
      })),
    );
  }

  /**
   * The register. With a location, the caller needs the permission there (checked by the guard);
   * without one, an organisation-wide grant.
   */
  async list(actor: AuthContext, f: CylinderFilters): Promise<{ total: number; cylinders: CylinderSummary[] }> {
    const search = f.search?.trim() ? f.search.trim().toUpperCase().replace(/[%_\\]/g, '') : null;
    const params = [
      todayInKenya(),
      RETEST_WARNING_DAYS,
      f.locationId ?? null,
      f.sizeId ?? null,
      f.physicalState ?? null,
      f.safety ?? null,
      search ? `%${search}%` : null,
    ];
    const where = `
      WHERE ($3::uuid IS NULL OR i.custody_location_id = $3)
        AND ($4::uuid IS NULL OR c.size_id = $4)
        AND ($5::text IS NULL OR i.physical_state = $5)
        AND ($6::text IS NULL OR sf.safety = $6)
        AND ($7::text IS NULL OR c.serial LIKE $7 OR t.epc LIKE $7)`;
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const total = await c.query<{ n: string }>(`SELECT count(*) AS n FROM (${BASE} ${where}) q`, params);
      const rows = await c.query<BaseRow>(
        `${BASE} ${where} ORDER BY z.nominal_fill_kg, c.serial NULLS LAST, i.registered_at LIMIT $8 OFFSET $9`,
        [...params, f.limit, f.offset],
      );
      return { total: Number(total.rows[0]!.n), cylinders: rows.rows.map(summary) };
    });
  }

  /** A cylinder's page: state, every tag it has had, and its life story. */
  async get(actor: AuthContext, itemId: string): Promise<CylinderDetail> {
    return withTenant(this.pool, actor.tenantId, (c) => this.load(c, actor, itemId));
  }

  /** Finds a cylinder from any tag it has ever had (a retired tag still identifies it, and is flagged). */
  async byTag(actor: AuthContext, rawEpc: string): Promise<CylinderDetail & { matchedTag: { epc: string; retired: boolean } }> {
    const epc = normalizeEpc(rawEpc);
    if (!epc) throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', 'That is not a tag number.', { fields: ['epc'] });
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const tag = await c.query<{ item_id: string; retired: boolean }>(
        'SELECT item_id, retired_at IS NOT NULL AS retired FROM item_tags WHERE epc = $1',
        [epc],
      );
      const found = tag.rows[0];
      if (!found) throw apiError(HttpStatus.NOT_FOUND, 'unknown_tag', 'No cylinder has ever had this tag.');
      const detail = await this.load(c, actor, found.item_id);
      return { ...detail, matchedTag: { epc, retired: found.retired } };
    });
  }

  private async load(c: PoolClient, actor: AuthContext, itemId: string): Promise<CylinderDetail> {
    const row = await c.query<BaseRow>(`${BASE} WHERE i.id = $3`, [todayInKenya(), RETEST_WARNING_DAYS, itemId]);
    const r = row.rows[0];
    if (!r) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such cylinder.');
    requireAt(actor, VIEW, r.custody_location_id);

    const tags = await c.query<{ epc: string; attached_at: Date; retired_at: Date | null; retire_reason: string | null }>(
      'SELECT epc, attached_at, retired_at, retire_reason FROM item_tags WHERE item_id = $1 ORDER BY attached_at',
      [itemId],
    );
    const history = await c.query<{ event_type: string; occurred_at: Date; actor: string | null; payload: Record<string, unknown> }>(
      `SELECT e.event_type, e.occurred_at, u.display_name AS actor, e.payload
       FROM business_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.aggregate_type = 'tracked_item' AND e.aggregate_id = $1
       ORDER BY e.occurred_at, e.id`,
      [itemId],
    );
    const detail: CylinderDetail = {
      ...summary(r),
      manufacturedOn: r.manufactured_on,
      tareKg: r.tare_kg === null ? null : Number(r.tare_kg),
      recordedNextTestDue: r.recorded_next_test_due,
      registeredAt: r.registered_at,
      tags: tags.rows.map((t) => ({ epc: t.epc, attachedAt: t.attached_at, retiredAt: t.retired_at, retireReason: t.retire_reason })),
      history: history.rows.map((h) => ({ type: h.event_type, occurredAt: h.occurred_at, actor: h.actor, payload: h.payload })),
    };
    // The security dimension is restricted to investigation roles, organisation-wide.
    if (canAt(actor, ['investigation.view'], null)) {
      const sec = await c.query<{ state: string }>('SELECT state FROM item_security WHERE item_id = $1', [itemId]);
      detail.security = sec.rows[0]?.state ?? 'normal';
    }
    return detail;
  }

  /**
   * Puts a new tag on a cylinder. The old tag (if any) is retired for good with the reason;
   * the cylinder keeps its identity and history.
   */
  async replaceTag(
    actor: AuthContext,
    itemId: string,
    input: { epc: string; reason: TagRetireReason },
  ): Promise<{ epc: string }> {
    const epc = normalizeEpc(input.epc);
    if (!epc) throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', 'That is not a tag number.', { fields: ['epc'] });
    try {
      return await withTenant(this.pool, actor.tenantId, async (c) => {
        const item = await c.query<{ custody_location_id: string | null }>(
          'SELECT custody_location_id FROM tracked_items WHERE id = $1 FOR UPDATE',
          [itemId],
        );
        const found = item.rows[0];
        if (!found) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such cylinder.');
        requireAt(actor, ['item.replace_tag'], found.custody_location_id);

        const existing = await c.query<{ item_id: string; retired: boolean }>(
          'SELECT item_id, retired_at IS NOT NULL AS retired FROM item_tags WHERE epc = $1',
          [epc],
        );
        const clash = existing.rows[0];
        if (clash) {
          if (clash.item_id === itemId && !clash.retired) {
            throw apiError(HttpStatus.CONFLICT, 'same_tag', 'That is already this cylinder\'s tag.');
          }
          throw apiError(
            HttpStatus.CONFLICT,
            clash.retired ? 'tag_retired' : 'tag_in_use',
            clash.retired ? 'That tag was retired and can never be used again.' : 'That tag is on another cylinder.',
          );
        }

        const old = await c.query<{ epc: string }>(
          `UPDATE item_tags SET retired_at = now(), retired_by = $2, retire_reason = $3
           WHERE item_id = $1 AND retired_at IS NULL RETURNING epc`,
          [itemId, actor.userId, input.reason],
        );
        await c.query(
          'INSERT INTO item_tags (tenant_id, epc, item_id, attached_by) VALUES (current_tenant_id(), $1, $2, $3)',
          [epc, itemId, actor.userId],
        );
        await recordEvent(c, {
          type: 'item.tag_replaced',
          aggregateType: 'tracked_item',
          aggregateId: itemId,
          payload: { oldEpc: old.rows[0]?.epc ?? null, newEpc: epc, reason: input.reason },
          actorId: actor.userId,
          ...(actor.deviceId ? { deviceId: actor.deviceId } : {}),
          occurredAt: new Date(),
        });
        return { epc };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw apiError(HttpStatus.CONFLICT, 'tag_in_use', 'That tag was just put on another cylinder.');
      }
      throw error;
    }
  }
}

function rowsError(rows: RowProblem[]) {
  return apiError(HttpStatus.BAD_REQUEST, 'invalid_rows', 'Some cylinders could not be registered. Nothing was saved.', { rows });
}
