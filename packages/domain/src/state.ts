/**
 * A tracked item's state is four independent dimensions (docs/drafts/cylinder-state-model.md).
 * Values here are for the cylinder item type.
 */
export const PHYSICAL_STATES = ['empty', 'filling', 'full', 'damaged', 'scrapped'] as const;
export type PhysicalState = (typeof PHYSICAL_STATES)[number];

export const CUSTODY_KINDS = [
  'depot',
  'truck',
  'wholesaler',
  'retailer',
  'end_customer',
  'sold_outright',
  'missing',
] as const;
export type CustodyKind = (typeof CUSTODY_KINDS)[number];

/** Set by people only (a hold), never by dates. Inspections and test dates belong to the later maintenance module. */
export const SAFETY_STATES = ['eligible', 'quarantined', 'condemned'] as const;
export type SafetyState = (typeof SAFETY_STATES)[number];

/** Restricted: only investigation roles may ever see this dimension. */
export const SECURITY_STATES = ['normal', 'missing', 'sighted', 'under_investigation', 'recovered'] as const;
export type SecurityState = (typeof SECURITY_STATES)[number];

export interface CustodyPosition {
  readonly kind: CustodyKind;
  /** The holder's id (truck, wholesaler, retailer...). Absent for sold_outright and missing. */
  readonly holderId?: string;
}

/** A full cylinder may only be dispatched while it is eligible. */
export function canDispatchFull(physical: PhysicalState, safety: SafetyState): boolean {
  return physical === 'full' && safety === 'eligible';
}
