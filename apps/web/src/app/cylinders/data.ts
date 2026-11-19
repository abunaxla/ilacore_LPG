import 'server-only';
import { can, type Permission } from '@ilacore/domain';
import type { Location } from '@/app/admin/data';
import type { Me } from '@/lib/auth';

export interface CylinderSize {
  id: string;
  name: string;
  nominalFillKg: number;
  retired: boolean;
}

export interface CylinderSettings {
  retestIntervalMonths: number | null;
  sizes: CylinderSize[];
}

export interface CylinderSummary {
  id: string;
  epc: string | null;
  serial: string | null;
  manufacturer: string | null;
  size: { id: string; name: string };
  physicalState: 'empty' | 'filling' | 'full' | 'damaged' | 'scrapped';
  custody: { kind: string; locationId: string | null; locationName: string | null };
  lastTestOn: string | null;
  nextTestDue: string | null;
  testDateKnown: boolean;
  safetyHold: string;
  safety: 'eligible' | 'retest_due' | 'retest_overdue' | 'quarantined' | 'condemned';
}

export interface CylinderDetail extends CylinderSummary {
  manufacturedOn: string | null;
  tareKg: number | null;
  recordedNextTestDue: string | null;
  registeredAt: string;
  tags: { epc: string; attachedAt: string; retiredAt: string | null; retireReason: string | null }[];
  history: { type: string; occurredAt: string; actor: string | null; payload: Record<string, unknown> }[];
  security?: string;
}

/**
 * The locations where the person holds any of `permissions` (for menus and defaults only; the API decides).
 * `everywhere` is true with an organisation-wide grant.
 */
export function placesFor(me: Me, permissions: readonly Permission[], locations: readonly Location[]) {
  const everywhere = permissions.some((p) => can(me.roles, p));
  const places = everywhere ? [...locations] : locations.filter((l) => permissions.some((p) => can(me.roles, p, l.id)));
  return { everywhere, places };
}

const dateFormat = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' });

/** A calendar date ("2026-11-20") for display. Kept in UTC so it never shifts a day. */
export const showDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`));
/** A moment in time, shown in Kenyan time. */
export const showTime = (iso: string) => timeFormat.format(new Date(iso));

/** Tag numbers are long; grouping them in fours makes them easier to read aloud. */
export const groupEpc = (epc: string) => epc.replace(/(.{4})(?=.)/g, '$1 ');
