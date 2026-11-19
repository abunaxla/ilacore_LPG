/**
 * Roles from docs/drafts/permission-matrix.md (adopted starting point). A role is a bundle of permissions.
 * Change the matrix document first, then this file.
 */
import { MFA_REQUIRED, type Permission } from './permissions.js';

/** How holders of a role reach the system. */
export type SignInChannel = 'web' | 'device' | 'web_and_device' | 'sms_only';

export interface RoleDefinition {
  readonly label: string;
  readonly permissions: readonly Permission[];
  readonly channel: SignInChannel;
}

const REPORTS: readonly Permission[] = ['report.operations', 'report.finance', 'report.owner'];

export const ROLES = {
  owner: {
    label: 'Owner / Director',
    permissions: [...REPORTS, 'item.view_position', 'loss.cancel', 'settings.manage'],
    channel: 'web',
  },
  senior_manager: {
    label: 'Senior manager',
    permissions: ['credit.approve', 'loss.cancel', ...REPORTS],
    channel: 'web',
  },
  finance: {
    label: 'Finance',
    permissions: [
      'credit.approve', 'account.stop', 'ledger.post_manual', 'ledger.reconcile', 'period.close',
      'loss.resolve', 'customer.change_phone', 'report.finance',
    ],
    channel: 'web',
  },
  depot_supervisor: {
    label: 'Depot supervisor',
    permissions: [
      'dispatch.approve_exception', 'handover.approve_exception', 'route.settle', 'stocktake.finalise',
      // Provisional (20 Nov 2026): no role held the item permissions; to be confirmed with the owner.
      'item.register', 'item.replace_tag', 'item.view_position',
    ],
    channel: 'web_and_device',
  },
  loader: { label: 'Loader', permissions: ['dispatch.scan'], channel: 'device' },
  filling_operator: { label: 'Filling / QC operator', permissions: ['filling.record', 'qc.record'], channel: 'device' },
  driver: { label: 'Driver', permissions: ['handover.perform'], channel: 'device' },
  field_supervisor: {
    label: 'Field supervisor / agent',
    permissions: ['audit.perform', 'handover.resolve_dispute'],
    channel: 'web_and_device',
  },
  stocktaker: { label: 'Stocktaker', permissions: ['stocktake.perform'], channel: 'device' },
  investigator: {
    label: 'Investigator',
    permissions: [
      'investigation.view', 'investigation.view_customer', 'investigation.manage', 'investigation.configure_thresholds',
    ],
    channel: 'web',
  },
  wholesaler_user: {
    label: 'Wholesaler user',
    permissions: ['handover.perform', 'handover.confirm', 'invoice.view'],
    channel: 'web_and_device',
  },
  retailer: { label: 'Retailer (light)', permissions: ['handover.confirm', 'invoice.view'], channel: 'sms_only' },
  administrator: { label: 'Administrator', permissions: ['user.manage', 'device.manage'], channel: 'web' },
} as const satisfies Record<string, RoleDefinition>;

export type RoleId = keyof typeof ROLES;

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

export function isRoleId(value: string): value is RoleId {
  return Object.hasOwn(ROLES, value);
}

/** One grant: a role for a person, organisation-wide (locationId null) or at one location. */
export interface RoleAssignment {
  readonly role: RoleId;
  readonly locationId: string | null;
}

function roleHas(role: RoleId, permission: Permission): boolean {
  return (ROLES[role].permissions as readonly Permission[]).includes(permission);
}

/**
 * Whether the assignments allow `permission`. Organisation-level actions (no location) need an
 * organisation-wide grant. Location-level actions accept an organisation-wide grant or one at that location.
 * Everything else is denied.
 */
export function can(assignments: readonly RoleAssignment[], permission: Permission, locationId?: string): boolean {
  return assignments.some(
    (a) =>
      roleHas(a.role, permission) &&
      (a.locationId === null || (locationId !== undefined && a.locationId === locationId)),
  );
}

/** Every permission the assignments grant anywhere (for menus; never for authorisation). */
export function permissionsOf(assignments: readonly RoleAssignment[]): Set<Permission> {
  return new Set(assignments.flatMap((a) => ROLES[a.role].permissions as readonly Permission[]));
}

/** MFA is required when any assigned role carries an MFA permission. */
export function requiresMfa(assignments: readonly RoleAssignment[]): boolean {
  return [...permissionsOf(assignments)].some((p) => MFA_REQUIRED.has(p));
}

/** Whether a role may be used through a channel. Retailers never sign in. */
export function roleAllowsChannel(role: RoleId, channel: 'web' | 'device'): boolean {
  const c: SignInChannel = ROLES[role].channel;
  return c === 'web_and_device' || c === channel;
}