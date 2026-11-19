/**
 * Per-task permissions, from docs/drafts/permission-matrix.md (adopted starting point, 19 Nov 2026).
 * Change the matrix document first, then this list. Everything not granted is denied.
 */
export const PERMISSIONS = [
  'item.register',
  'item.replace_tag',
  'item.view_position',
  'filling.record',
  'qc.record',
  'safety.requalify',
  'dispatch.scan',
  'dispatch.approve_exception',
  'handover.perform',
  'handover.confirm',
  'handover.approve_exception',
  'handover.resolve_dispute',
  'route.settle',
  'stocktake.perform',
  'stocktake.finalise',
  'audit.perform',
  'pricing.manage',
  'invoice.view',
  'customer.manage',
  'customer.change_phone',
  'credit.approve',
  'account.stop',
  'ledger.post_manual',
  'ledger.reconcile',
  'period.close',
  'loss.resolve',
  'loss.cancel',
  'investigation.view',
  'investigation.view_customer',
  'investigation.manage',
  'investigation.configure_thresholds',
  'user.manage',
  'device.manage',
  'settings.manage',
  'report.operations',
  'report.finance',
  'report.owner',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** Permissions whose holders must use MFA. */
export const MFA_REQUIRED: ReadonlySet<Permission> = new Set<Permission>([
  'investigation.view',
  'investigation.view_customer',
  'investigation.manage',
  'investigation.configure_thresholds',
  'credit.approve',
  'ledger.post_manual',
  'period.close',
  'loss.cancel',
  'user.manage',
  'device.manage',
  'settings.manage',
]);

/**
 * Pairs that one person must not both exercise on the same record (separation of duties).
 * The API checks these against the record's history, not just against the user's roles.
 */
export const SEPARATION_OF_DUTIES: ReadonlyArray<readonly [Permission, Permission, string]> = [
  ['dispatch.scan', 'dispatch.approve_exception', 'The loader cannot approve their own dispatch exceptions'],
  ['handover.perform', 'route.settle', 'A driver cannot settle their own route'],
  ['stocktake.perform', 'stocktake.finalise', 'The stocktaker cannot finalise their own variances'],
];
