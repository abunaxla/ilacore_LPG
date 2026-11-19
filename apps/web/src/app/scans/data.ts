import 'server-only';

export interface ScanSessionSummary {
  id: string;
  purpose: 'registration' | 'dispatch' | 'stocktake' | 'audit';
  location: { id: string; name: string };
  device: { id: string; name: string } | null;
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
  rawReads: number;
  tags: number;
}

export interface SeenLine {
  epc: string;
  reads: number;
  strongestRssi: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  tag: 'active' | 'retired' | 'unknown';
  cylinder: { id: string; serial: string | null; size: string; physicalState: string } | null;
}

export interface ScanSessionDetail extends ScanSessionSummary {
  seen: SeenLine[];
  counts: { active: number; retired: number; unknown: number };
}

/** Anyone who scans, or who works with cylinders, can see scan sessions at their places. */
export const SCAN_VIEWERS = ['item.view_position', 'item.register', 'dispatch.scan', 'stocktake.perform', 'audit.perform'] as const;
