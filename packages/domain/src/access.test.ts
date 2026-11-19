import { describe, expect, it } from 'vitest';
import { checkPassword, checkPin, lockoutDurationMs } from './credentials.js';
import { normalizeKenyanPhone } from './phone.js';
import { can, permissionsOf, requiresMfa, roleAllowsChannel, ROLES } from './roles.js';
import { checkSeparation } from './separation.js';
import { isPermission } from './permissions.js';

describe('normalizeKenyanPhone', () => {
  it.each([
    ['0712345678', '+254712345678'],
    ['+254 712 345 678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['712-345-678', '+254712345678'],
    ['0110 123456', '+254110123456'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each(['0212345678', '071234567', '+255712345678', 'phone', ''])('rejects %s', (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
  });
});

describe('checkPassword', () => {
  it('accepts a long, uncommon password', () => {
    expect(checkPassword('maize-lorry-kisumu-42')).toEqual([]);
  });
  it('rejects short, common and single-character passwords', () => {
    expect(checkPassword('short')).toContain('too_short');
    expect(checkPassword('Password12345!')).toContain('common');
    expect(checkPassword('aaaaaaaaaaaaaa')).toContain('one_character');
  });
  it('rejects a password containing the phone number', () => {
    expect(checkPassword('mine712345678x', { phone: '+254712345678' })).toContain('contains_phone');
  });
});

describe('checkPin', () => {
  it('accepts an ordinary 6-digit PIN', () => {
    expect(checkPin('480317')).toEqual([]);
  });
  it.each([
    ['1234', 'not_six_digits'],
    ['12a456', 'not_six_digits'],
    ['777777', 'repeated'],
    ['123456', 'sequential'],
    ['987654', 'sequential'],
    ['121212', 'common'],
  ])('rejects %s (%s)', (pin, problem) => {
    expect(checkPin(pin)).toContain(problem);
  });
});

describe('lockoutDurationMs', () => {
  it('locks from the fifth failure, doubling every five, capped at a day', () => {
    expect(lockoutDurationMs(4)).toBe(0);
    expect(lockoutDurationMs(5)).toBe(15 * 60_000);
    expect(lockoutDurationMs(10)).toBe(30 * 60_000);
    expect(lockoutDurationMs(100)).toBe(24 * 60 * 60_000);
  });
});

describe('roles and permissions', () => {
  it('only uses permissions that exist', () => {
    for (const role of Object.values(ROLES)) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
  });

  it('never gives Finance the power to cancel a loss charge', () => {
    expect(can([{ role: 'finance', locationId: null }], 'loss.cancel')).toBe(false);
  });

  it('denies anything not granted', () => {
    expect(can([{ role: 'driver', locationId: null }], 'route.settle')).toBe(false);
    expect(can([], 'handover.perform')).toBe(false);
  });

  it('limits a location grant to that location', () => {
    const nakuru = [{ role: 'depot_supervisor', locationId: 'nakuru' }] as const;
    expect(can(nakuru, 'route.settle', 'nakuru')).toBe(true);
    expect(can(nakuru, 'route.settle', 'eldoret')).toBe(false);
    expect(can(nakuru, 'route.settle')).toBe(false);
  });

  it('lets an organisation-wide grant act at any location', () => {
    expect(can([{ role: 'depot_supervisor', locationId: null }], 'route.settle', 'eldoret')).toBe(true);
  });

  it('requires MFA for privileged and investigation roles only', () => {
    expect(requiresMfa([{ role: 'investigator', locationId: null }])).toBe(true);
    expect(requiresMfa([{ role: 'administrator', locationId: null }])).toBe(true);
    expect(requiresMfa([{ role: 'finance', locationId: null }])).toBe(true);
    expect(requiresMfa([{ role: 'driver', locationId: null }, { role: 'loader', locationId: null }])).toBe(false);
  });

  it('collects permissions across roles', () => {
    const p = permissionsOf([{ role: 'loader', locationId: 'x' }, { role: 'driver', locationId: null }]);
    expect([...p].sort()).toEqual(['dispatch.scan', 'handover.perform']);
  });

  it('keeps retailers off both sign-in channels and field roles off the web', () => {
    expect(roleAllowsChannel('retailer', 'web')).toBe(false);
    expect(roleAllowsChannel('retailer', 'device')).toBe(false);
    expect(roleAllowsChannel('driver', 'web')).toBe(false);
    expect(roleAllowsChannel('driver', 'device')).toBe(true);
    expect(roleAllowsChannel('depot_supervisor', 'web')).toBe(true);
  });
});

describe('checkSeparation', () => {
  it('stops the loader approving their own dispatch exception', () => {
    const history = [{ permission: 'dispatch.scan', actorId: 'amina' }] as const;
    expect(checkSeparation('dispatch.approve_exception', 'amina', history)?.conflictsWith).toBe('dispatch.scan');
    expect(checkSeparation('dispatch.approve_exception', 'otieno', history)).toBeNull();
  });

  it('works in both directions', () => {
    const history = [{ permission: 'stocktake.finalise', actorId: 'wanjiku' }] as const;
    expect(checkSeparation('stocktake.perform', 'wanjiku', history)).not.toBeNull();
  });

  it('stops a driver settling their own route', () => {
    const history = [{ permission: 'handover.perform', actorId: 'kamau' }] as const;
    expect(checkSeparation('route.settle', 'kamau', history)?.reason).toMatch(/own route/);
  });

  it('ignores permissions that are not in a pair', () => {
    expect(checkSeparation('qc.record', 'x', [{ permission: 'filling.record', actorId: 'x' }])).toBeNull();
  });
});