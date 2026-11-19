/**
 * Separation of duties: one person must not exercise both permissions of a conflicting pair on the
 * same record. Checked against what actually happened on the record, not just against roles.
 */
import { SEPARATION_OF_DUTIES, type Permission } from './permissions.js';

export interface RecordAction {
  readonly permission: Permission;
  readonly actorId: string;
}

export interface SeparationViolation {
  readonly conflictsWith: Permission;
  readonly reason: string;
}

/** Returns the violation if `actorId` doing `permission` now would break separation of duties. */
export function checkSeparation(
  permission: Permission,
  actorId: string,
  history: readonly RecordAction[],
): SeparationViolation | null {
  for (const [a, b, reason] of SEPARATION_OF_DUTIES) {
    const other = permission === a ? b : permission === b ? a : null;
    if (other && history.some((h) => h.permission === other && h.actorId === actorId)) {
      return { conflictsWith: other, reason };
    }
  }
  return null;
}