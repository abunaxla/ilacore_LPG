/**
 * Scan sessions: what a reader saw during one job (dispatch, stocktake, audit, registration).
 * A scan is an observation. It never changes a cylinder's state on its own; later steps (handovers,
 * stocktakes) use the session's reviewed list.
 */
import type { Permission } from './permissions.js';

export const SCAN_PURPOSES = ['registration', 'dispatch', 'stocktake', 'audit'] as const;
export type ScanPurpose = (typeof SCAN_PURPOSES)[number];

/** The permission needed to open (and send reads to) a session for each purpose. */
export const SCAN_PURPOSE_PERMISSION: Readonly<Record<ScanPurpose, Permission>> = {
  registration: 'item.register',
  dispatch: 'dispatch.scan',
  stocktake: 'stocktake.perform',
  audit: 'audit.perform',
};

/** Most reads accepted in one upload. Readers send in batches. */
export const MAX_READS_PER_BATCH = 500;

/** One raw read, as a reader reports it. */
export interface RawRead {
  readonly epc: string;
  /** Signal strength in dBm (negative; closer to 0 is stronger). */
  readonly rssi: number | null;
  readonly antenna: number | null;
  readonly readAt: Date;
}

/** One tag in a session, with its duplicate reads merged. */
export interface SeenTag {
  readonly epc: string;
  readonly reads: number;
  readonly strongestRssi: number | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

/** Merges duplicate reads into one line per tag, in the order tags were first seen. */
export function mergeReads(reads: readonly RawRead[]): SeenTag[] {
  const byEpc = new Map<string, { epc: string; reads: number; strongestRssi: number | null; firstSeenAt: Date; lastSeenAt: Date }>();
  for (const r of reads) {
    const seen = byEpc.get(r.epc);
    if (!seen) {
      byEpc.set(r.epc, { epc: r.epc, reads: 1, strongestRssi: r.rssi, firstSeenAt: r.readAt, lastSeenAt: r.readAt });
      continue;
    }
    seen.reads += 1;
    if (r.rssi !== null && (seen.strongestRssi === null || r.rssi > seen.strongestRssi)) seen.strongestRssi = r.rssi;
    if (r.readAt < seen.firstSeenAt) seen.firstSeenAt = r.readAt;
    if (r.readAt > seen.lastSeenAt) seen.lastSeenAt = r.readAt;
  }
  return [...byEpc.values()].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
}

/**
 * Compares what was expected with what was seen: present, missing (expected, not seen) and
 * unexpected (seen, not expected; a stray read or a cylinder that shouldn't be there).
 */
export function compareSeen(
  expected: Iterable<string>,
  seen: Iterable<string>,
): { present: string[]; missing: string[]; unexpected: string[] } {
  const want = new Set(expected);
  const got = new Set(seen);
  return {
    present: [...want].filter((e) => got.has(e)),
    missing: [...want].filter((e) => !got.has(e)),
    unexpected: [...got].filter((e) => !want.has(e)),
  };
}
