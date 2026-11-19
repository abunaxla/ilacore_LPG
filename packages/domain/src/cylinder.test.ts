import { describe, expect, it } from 'vitest';
import {
  addMonths,
  checkCylinderSize,
  daysBetween,
  isIsoDate,
  isSafeToDispatch,
  nextTestDue,
  normalizeEpc,
  normalizeSerial,
  safetyState,
  todayInKenya,
} from './cylinder.js';
import { compareSeen, mergeReads } from './scan.js';

describe('tag numbers and serials', () => {
  it('normalises an EPC and rejects anything that is not one', () => {
    expect(normalizeEpc('e280 1160-6000:0207')).toBe('E280116060000207');
    expect(normalizeEpc('E2801160600002070000ABCD')).toBe('E2801160600002070000ABCD');
    expect(normalizeEpc('1234')).toBeNull();
    expect(normalizeEpc('not-a-tag-123')).toBeNull();
  });

  it('normalises a stamped serial', () => {
    expect(normalizeSerial('  ab  12 3 ')).toBe('AB 12 3');
    expect(normalizeSerial('   ')).toBeNull();
    expect(normalizeSerial('x'.repeat(41))).toBeNull();
  });
});

describe('dates', () => {
  it('accepts only real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
  });

  it('adds months and clamps to the end of the month', () => {
    expect(addMonths('2021-01-31', 1)).toBe('2021-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2016-06-15', 120)).toBe('2026-06-15');
  });

  it('counts days and knows the Kenyan date', () => {
    expect(daysBetween('2026-11-20', '2026-12-20')).toBe(30);
    expect(daysBetween('2026-11-20', '2026-11-19')).toBe(-1);
    // 22:30 UTC is already the next morning in Nairobi.
    expect(todayInKenya(new Date('2026-11-19T22:30:00Z'))).toBe('2026-11-20');
  });
});

describe('test due date', () => {
  it('prefers a recorded due date, else last test plus the interval, else unknown', () => {
    expect(nextTestDue({ nextTestDue: '2027-03-01', lastTestOn: '2020-01-01', retestIntervalMonths: 60 })).toBe('2027-03-01');
    expect(nextTestDue({ lastTestOn: '2022-05-10', retestIntervalMonths: 60 })).toBe('2027-05-10');
    expect(nextTestDue({ lastTestOn: '2022-05-10', retestIntervalMonths: null })).toBeNull();
    expect(nextTestDue({})).toBeNull();
  });
});

describe('safety', () => {
  const today = '2026-11-20';

  it('is eligible well before the due date, due inside 30 days, overdue after', () => {
    expect(safetyState({ hold: 'none', nextTestDue: '2027-06-01', today })).toBe('eligible');
    expect(safetyState({ hold: 'none', nextTestDue: '2026-12-20', today })).toBe('retest_due');
    expect(safetyState({ hold: 'none', nextTestDue: '2026-11-19', today })).toBe('retest_overdue');
  });

  it('lets a hold win over any date', () => {
    expect(safetyState({ hold: 'quarantined', nextTestDue: '2030-01-01', today })).toBe('quarantined');
    expect(safetyState({ hold: 'condemned', nextTestDue: '2030-01-01', today })).toBe('condemned');
  });

  it('treats an unknown test date as due, and blocks dispatch until it is recorded', () => {
    expect(safetyState({ hold: 'none', nextTestDue: null, today })).toBe('retest_due');
    expect(isSafeToDispatch({ hold: 'none', nextTestDue: null, today })).toBe(false);
  });

  it('allows dispatch while eligible or due soon, never when overdue or held', () => {
    expect(isSafeToDispatch({ hold: 'none', nextTestDue: '2027-06-01', today })).toBe(true);
    expect(isSafeToDispatch({ hold: 'none', nextTestDue: '2026-12-01', today })).toBe(true);
    expect(isSafeToDispatch({ hold: 'none', nextTestDue: '2026-11-01', today })).toBe(false);
    expect(isSafeToDispatch({ hold: 'quarantined', nextTestDue: '2027-06-01', today })).toBe(false);
  });
});

describe('cylinder sizes', () => {
  it('accepts sensible sizes and names the problems otherwise', () => {
    expect(checkCylinderSize({ name: '22.5 kg', nominalFillKg: 22.5 })).toEqual([]);
    expect(checkCylinderSize({ name: ' ', nominalFillKg: 0 })).toEqual(['name', 'nominalFillKg']);
    expect(checkCylinderSize({ name: '3 kg', nominalFillKg: 3.125 })).toEqual(['nominalFillKg']);
  });
});

describe('scan reads', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 20, 8, 0, s));

  it('merges duplicates, keeps the strongest signal and first/last times', () => {
    const merged = mergeReads([
      { epc: 'B1', rssi: -60, antenna: 1, readAt: at(2) },
      { epc: 'A1', rssi: -70, antenna: 1, readAt: at(1) },
      { epc: 'A1', rssi: -55, antenna: 2, readAt: at(5) },
      { epc: 'A1', rssi: null, antenna: null, readAt: at(3) },
    ]);
    expect(merged.map((m) => m.epc)).toEqual(['A1', 'B1']);
    expect(merged[0]).toMatchObject({ reads: 3, strongestRssi: -55, firstSeenAt: at(1), lastSeenAt: at(5) });
  });

  it('finds missing and unexpected tags', () => {
    expect(compareSeen(['A', 'B', 'C'], ['B', 'C', 'X'])).toEqual({ present: ['B', 'C'], missing: ['A'], unexpected: ['X'] });
  });
});
