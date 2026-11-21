import 'server-only';
import type { Permission } from '@ilacore/domain';

export type TripStatus = 'loading' | 'out' | 'cancelled';
export type LineException = 'not_at_depot' | 'retired_tag' | 'not_full';

export interface TripSummary {
  id: string;
  depot: { id: string; name: string };
  driver: { id: string; name: string };
  vehicleReg: string;
  status: TripStatus;
  note: string | null;
  openedBy: string;
  openedAt: string;
  signedAt: string | null;
  counts: { loaded: number; needsApproval: number; delivered: number; collected: number; back: number; stillOut: number };
}

export interface TripLine {
  itemId: string;
  epc: string;
  cylinder: { serial: string | null; size: string };
  physicalState: 'empty' | 'full';
  exception: LineException | null;
  approvedBy: string | null;
  addedBy: string;
  addedAt: string;
  removedAt: string | null;
  returnedAt: string | null;
  returnedState: 'empty' | 'full' | null;
  deliveredAt: string | null;
  /** An empty picked up from a shop on this trip, not part of the load. */
  collected: boolean;
}

export type HandoverStatus = 'open' | 'awaiting_confirmation' | 'confirmed' | 'unconfirmed' | 'disputed' | 'cancelled';

export interface HandoverSummary {
  id: string;
  customer: { id: string; name: string; kind: 'retailer' | 'wholesaler' };
  giver: { id: string; name: string };
  status: HandoverStatus;
  ref: string;
  openedAt: string;
  closedAt: string | null;
  balance: { fullOut: number; emptyIn: number; soldOutright: number; uncovered: number };
  owed: { count: number; dueOn: string; approvedBy: string | null } | null;
  shortfall: number | null;
  disputeNote: string | null;
}

export interface TripDetail extends TripSummary {
  lines: TripLine[];
  handovers: HandoverSummary[];
}

/** Who sees trips on the web (drivers and loaders work on the handheld). */
export const TRIP_VIEWERS: readonly Permission[] = ['dispatch.scan', 'dispatch.approve_exception', 'route.settle', 'item.view_position'];

/** Number plates are stored as KCA123A; shown as KCA 123A. */
export const showPlate = (reg: string) => reg.replace(/^([A-Z]{3})(\d)/, '$1 $2');
