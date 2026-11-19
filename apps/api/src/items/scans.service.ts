import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  MAX_READS_PER_BATCH,
  normalizeEpc,
  SCAN_PURPOSE_PERMISSION,
  type Permission,
  type ScanPurpose,
} from '@ilacore/domain';
import type { Pool } from 'pg';
import { canAt, requireAt } from '../access/require-at.js';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import type { RequestMeta } from '../http/request.js';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';

/** How far in the future a read's timestamp may be (reader clocks drift). */
const CLOCK_SKEW_MS = 5 * 60_000;

const VIEW: readonly Permission[] = ['item.view_position', 'item.register'];

export interface IncomingRead {
  epc: string;
  rssi?: number | null | undefined;
  antenna?: number | null | undefined;
  readAt: string;
}

export interface SessionSummary {
  id: string;
  purpose: ScanPurpose;
  location: { id: string; name: string };
  device: { id: string; name: string } | null;
  openedBy: string;
  openedAt: Date;
  closedAt: Date | null;
  note: string | null;
  rawReads: number;
  tags: number;
}

export interface SeenTagLine {
  epc: string;
  reads: number;
  strongestRssi: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** active: on a cylinder now; retired: a tag that was taken off (worth a look); unknown: never registered. */
  tag: 'active' | 'retired' | 'unknown';
  cylinder: { id: string; serial: string | null; size: string; physicalState: string } | null;
}

export interface SessionDetail extends SessionSummary {
  seen: SeenTagLine[];
  counts: { active: number; retired: number; unknown: number };
}

/**
 * Scan sessions: one reader or handheld scanning for one job at one place. Reads are stored raw
 * (duplicates, strays and all) as evidence and merged per tag for review. A scan never changes a
 * cylinder's state; handovers and stocktakes (step 4) use the reviewed list.
 */
@Injectable()
export class ScansService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async open(
    actor: AuthContext,
    input: { purpose: ScanPurpose; locationId: string; note?: string | undefined },
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    requireAt(actor, [SCAN_PURPOSE_PERMISSION[input.purpose]], input.locationId);
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const loc = await c.query('SELECT 1 FROM locations WHERE id = $1', [input.locationId]);
      if (loc.rowCount !== 1) throw apiError(HttpStatus.BAD_REQUEST, 'unknown_location', 'There is no such location.');
      const row = await c.query<{ id: string }>(
        `INSERT INTO scan_sessions (tenant_id, purpose, location_id, device_id, note, opened_by)
         VALUES (current_tenant_id(), $1, $2, $3, $4, $5) RETURNING id`,
        [input.purpose, input.locationId, actor.deviceId, input.note?.trim() || null, actor.userId],
      );
      const id = row.rows[0]!.id;
      await recordAudit(c, {
        action: 'scan_session.opened',
        actorId: actor.userId,
        deviceId: actor.deviceId ?? undefined,
        targetType: 'scan_session',
        targetId: id,
        details: { purpose: input.purpose, locationId: input.locationId },
        ...meta,
      });
      return { id };
    });
  }

  /**
   * Stores one batch of raw reads. The batch id is chosen by the reader: sending the same batch again
   * (after a dropped connection) is accepted and ignored, so nothing is counted twice.
   */
  async addReads(
    actor: AuthContext,
    sessionId: string,
    input: { batchId: string; reads: readonly IncomingRead[] },
  ): Promise<{ accepted: number; duplicateBatch: boolean }> {
    if (input.reads.length > MAX_READS_PER_BATCH) {
      throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', `At most ${MAX_READS_PER_BATCH} reads per batch.`);
    }
    const latest = Date.now() + CLOCK_SKEW_MS;
    const bad: string[] = [];
    const reads = input.reads.map((r, i) => {
      const epc = normalizeEpc(r.epc);
      const at = new Date(r.readAt);
      if (!epc) bad.push(`reads.${i}.epc`);
      if (Number.isNaN(at.getTime()) || at.getTime() > latest) bad.push(`reads.${i}.readAt`);
      if (r.rssi != null && !(r.rssi >= -127 && r.rssi <= 20)) bad.push(`reads.${i}.rssi`);
      if (r.antenna != null && !(Number.isInteger(r.antenna) && r.antenna >= 0 && r.antenna <= 64)) bad.push(`reads.${i}.antenna`);
      return { epc: epc ?? '', rssi: r.rssi ?? null, antenna: r.antenna ?? null, readAt: at };
    });
    if (bad.length > 0) throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', 'Some reads are not valid.', { fields: bad.slice(0, 20) });

    return withTenant(this.pool, actor.tenantId, async (c) => {
      // Locking the session serialises its batches and closing.
      const s = await c.query<{ purpose: ScanPurpose; location_id: string; device_id: string | null; opened_by: string; closed_at: Date | null }>(
        'SELECT purpose, location_id, device_id, opened_by, closed_at FROM scan_sessions WHERE id = $1 FOR UPDATE',
        [sessionId],
      );
      const session = s.rows[0];
      if (!session) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such scan session.');
      requireAt(actor, [SCAN_PURPOSE_PERMISSION[session.purpose]], session.location_id);
      const sameSource = session.device_id ? actor.deviceId === session.device_id : actor.deviceId === null && actor.userId === session.opened_by;
      if (!sameSource) {
        throw apiError(HttpStatus.FORBIDDEN, 'wrong_device', 'Only the reader that opened this session can send reads to it.');
      }

      const seen = await c.query('SELECT 1 FROM scan_batches WHERE session_id = $1 AND batch_id = $2', [sessionId, input.batchId]);
      if (seen.rowCount === 1) return { accepted: 0, duplicateBatch: true };
      if (session.closed_at) throw apiError(HttpStatus.CONFLICT, 'session_closed', 'This scan session is closed.');

      await c.query(
        'INSERT INTO scan_batches (session_id, batch_id, tenant_id, read_count) VALUES ($1, $2, current_tenant_id(), $3)',
        [sessionId, input.batchId, reads.length],
      );
      if (reads.length > 0) {
        await c.query(
          `INSERT INTO scan_reads (tenant_id, session_id, batch_id, epc, rssi, antenna, read_at)
           SELECT current_tenant_id(), $1, $2, r.epc, r.rssi, r.antenna, r.read_at
           FROM unnest($3::text[], $4::numeric[], $5::smallint[], $6::timestamptz[]) AS r(epc, rssi, antenna, read_at)`,
          [sessionId, input.batchId, reads.map((r) => r.epc), reads.map((r) => r.rssi), reads.map((r) => r.antenna), reads.map((r) => r.readAt)],
        );
      }
      return { accepted: reads.length, duplicateBatch: false };
    });
  }

  async close(actor: AuthContext, sessionId: string, meta: RequestMeta): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      const s = await c.query<{ purpose: ScanPurpose; location_id: string; closed_at: Date | null }>(
        'SELECT purpose, location_id, closed_at FROM scan_sessions WHERE id = $1 FOR UPDATE',
        [sessionId],
      );
      const session = s.rows[0];
      if (!session) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such scan session.');
      requireAt(actor, [SCAN_PURPOSE_PERMISSION[session.purpose]], session.location_id);
      if (session.closed_at) throw apiError(HttpStatus.CONFLICT, 'session_closed', 'This scan session is already closed.');
      await c.query('UPDATE scan_sessions SET closed_at = now(), closed_by = $2 WHERE id = $1', [sessionId, actor.userId]);
      await recordAudit(c, {
        action: 'scan_session.closed',
        actorId: actor.userId,
        deviceId: actor.deviceId ?? undefined,
        targetType: 'scan_session',
        targetId: sessionId,
        ...meta,
      });
    });
  }

  /** Recent sessions the caller may see (at locations where they scan for that purpose, or view cylinders). */
  async list(actor: AuthContext): Promise<SessionSummary[]> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const rows = await c.query<SessionRow>(`${SESSION_QUERY} ORDER BY s.opened_at DESC LIMIT 200`);
      return rows.rows
        .filter((r) => canAt(actor, [SCAN_PURPOSE_PERMISSION[r.purpose], ...VIEW], r.location_id))
        .slice(0, 100)
        .map(sessionSummary);
    });
  }

  /** One session with its reads merged per tag and matched to cylinders. */
  async get(actor: AuthContext, sessionId: string): Promise<SessionDetail> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const s = await c.query<SessionRow>(`${SESSION_QUERY} WHERE s.id = $1`, [sessionId]);
      const row = s.rows[0];
      if (!row) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such scan session.');
      requireAt(actor, [SCAN_PURPOSE_PERMISSION[row.purpose], ...VIEW], row.location_id);

      const seen = await c.query<{
        epc: string; reads: string; strongest: string | null; first_seen: Date; last_seen: Date;
        item_id: string | null; retired: boolean | null; serial: string | null; size: string | null; physical_state: string | null;
      }>(
        `SELECT r.epc, r.reads, r.strongest, r.first_seen, r.last_seen,
                t.item_id, t.retired_at IS NOT NULL AS retired, c.serial, z.name AS size, i.physical_state
         FROM (
           SELECT epc, count(*) AS reads, max(rssi) AS strongest, min(read_at) AS first_seen, max(read_at) AS last_seen
           FROM scan_reads WHERE session_id = $1 GROUP BY epc
         ) r
         LEFT JOIN item_tags t ON t.epc = r.epc
         LEFT JOIN tracked_items i ON i.id = t.item_id
         LEFT JOIN cylinders c ON c.item_id = i.id
         LEFT JOIN cylinder_sizes z ON z.id = c.size_id
         ORDER BY r.first_seen, r.epc`,
        [sessionId],
      );
      const lines: SeenTagLine[] = seen.rows.map((r) => ({
        epc: r.epc,
        reads: Number(r.reads),
        strongestRssi: r.strongest === null ? null : Number(r.strongest),
        firstSeenAt: r.first_seen,
        lastSeenAt: r.last_seen,
        tag: r.item_id === null ? 'unknown' : r.retired ? 'retired' : 'active',
        cylinder: r.item_id
          ? { id: r.item_id, serial: r.serial, size: r.size ?? '', physicalState: r.physical_state ?? '' }
          : null,
      }));
      return {
        ...sessionSummary(row),
        seen: lines,
        counts: {
          active: lines.filter((l) => l.tag === 'active').length,
          retired: lines.filter((l) => l.tag === 'retired').length,
          unknown: lines.filter((l) => l.tag === 'unknown').length,
        },
      };
    });
  }
}

const SESSION_QUERY = `
  SELECT s.id, s.purpose, s.location_id, l.name AS location_name, s.device_id, d.name AS device_name,
         u.display_name AS opened_by, s.opened_at, s.closed_at, s.note,
         (SELECT count(*) FROM scan_reads r WHERE r.session_id = s.id) AS raw_reads,
         (SELECT count(DISTINCT epc) FROM scan_reads r WHERE r.session_id = s.id) AS tags
  FROM scan_sessions s
  JOIN locations l ON l.id = s.location_id
  JOIN users u ON u.id = s.opened_by
  LEFT JOIN devices d ON d.id = s.device_id`;

interface SessionRow {
  id: string;
  purpose: ScanPurpose;
  location_id: string;
  location_name: string;
  device_id: string | null;
  device_name: string | null;
  opened_by: string;
  opened_at: Date;
  closed_at: Date | null;
  note: string | null;
  raw_reads: string;
  tags: string;
}

function sessionSummary(r: SessionRow): SessionSummary {
  return {
    id: r.id,
    purpose: r.purpose,
    location: { id: r.location_id, name: r.location_name },
    device: r.device_id ? { id: r.device_id, name: r.device_name ?? '' } : null,
    openedBy: r.opened_by,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    note: r.note,
    rawReads: Number(r.raw_reads),
    tags: Number(r.tags),
  };
}
