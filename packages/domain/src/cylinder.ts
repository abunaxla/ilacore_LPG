/**
 * Cylinder rules: tag numbers, sizes, test dates and safety eligibility.
 * See docs/drafts/cylinder-state-model.md. Dates without a time are ISO strings, "YYYY-MM-DD".
 */
import type { SafetyState } from './state.js';

/** Hold placed by QC or an inspector. Time never lifts it; only a recorded event does. */
export const SAFETY_HOLDS = ['none', 'quarantined', 'condemned'] as const;
export type SafetyHold = (typeof SAFETY_HOLDS)[number];

/** Why a tag was taken off a cylinder. A retired tag is never used again. */
export const TAG_RETIRE_REASONS = ['damaged', 'unreadable', 'lost', 'other'] as const;
export type TagRetireReason = (typeof TAG_RETIRE_REASONS)[number];

/** Days before the test due date when a cylinder shows as "test due" (still dispatchable). */
export const RETEST_WARNING_DAYS = 30;

/**
 * Normalises an RFID tag number (EPC) to upper-case hex without spaces, colons or dashes.
 * The tag type isn't chosen yet, so any 8-64 hex digits are accepted (a 96-bit EPC is 24).
 * Returns null when it isn't a tag number.
 */
export function normalizeEpc(raw: string): string | null {
  const epc = raw.replace(/[\s:-]/g, '').toUpperCase();
  return /^[0-9A-F]{8,64}$/.test(epc) ? epc : null;
}

/** Normalises a stamped serial number: trimmed, inner spaces collapsed, upper case. Null if empty or too long. */
export function normalizeSerial(raw: string): string | null {
  const serial = raw.trim().replace(/\s+/g, ' ').toUpperCase();
  return serial.length >= 1 && serial.length <= 40 ? serial : null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` is a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

function toUtc(date: string): Date {
  if (!isIsoDate(date)) throw new RangeError(`Not a date: ${date}`);
  return new Date(`${date}T00:00:00Z`);
}

/** Adds whole months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  if (!Number.isInteger(months)) throw new RangeError('months must be a whole number');
  const d = toUtc(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

/** Days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Today's date in Kenya (East Africa Time, UTC+3, no daylight saving). */
export function todayInKenya(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * When the next test is due. An explicit due date (for example stamped on the cylinder) wins;
 * otherwise it is the last test plus the organisation's interval. Null when neither is known.
 */
export function nextTestDue(input: {
  readonly nextTestDue?: string | null | undefined;
  readonly lastTestOn?: string | null | undefined;
  readonly retestIntervalMonths?: number | null | undefined;
}): string | null {
  if (input.nextTestDue) return input.nextTestDue;
  if (input.lastTestOn && input.retestIntervalMonths) return addMonths(input.lastTestOn, input.retestIntervalMonths);
  return null;
}

export interface SafetyInput {
  readonly hold: SafetyHold;
  /** Null when nobody has recorded a test date and no interval is set. */
  readonly nextTestDue: string | null;
  readonly today: string;
}

/**
 * The safety dimension. A hold always wins. With no known due date the cylinder counts as "test due"
 * so it is flagged (see isSafeToDispatch: it can't go out full until a test date is recorded).
 */
export function safetyState(input: SafetyInput): SafetyState {
  if (input.hold === 'condemned') return 'condemned';
  if (input.hold === 'quarantined') return 'quarantined';
  if (input.nextTestDue === null) return 'retest_due';
  const days = daysBetween(input.today, input.nextTestDue);
  if (days < 0) return 'retest_overdue';
  if (days <= RETEST_WARNING_DAYS) return 'retest_due';
  return 'eligible';
}

/**
 * Whether a cylinder may go out full, as far as safety goes. "Test due" within the warning window still
 * may; an unknown test date, an overdue test or any hold may not.
 */
export function isSafeToDispatch(input: SafetyInput): boolean {
  const state = safetyState(input);
  if (state === 'eligible') return true;
  return state === 'retest_due' && input.nextTestDue !== null;
}

/** A cylinder size the organisation runs. */
export interface CylinderSizeInput {
  readonly name: string;
  /** Weight of gas when full, in kg. */
  readonly nominalFillKg: number;
}

/** The sizes every new organisation starts with. More are added on the settings page. */
export const DEFAULT_CYLINDER_SIZES: readonly CylinderSizeInput[] = [
  { name: '6 kg', nominalFillKg: 6 },
  { name: '13 kg', nominalFillKg: 13 },
  { name: '50 kg', nominalFillKg: 50 },
];

/** Problems with a size (field names), or an empty list. Weights allow two decimals, up to 1000 kg. */
export function checkCylinderSize(input: CylinderSizeInput): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  if (name.length < 1 || name.length > 30) problems.push('name');
  const kg = input.nominalFillKg;
  if (!Number.isFinite(kg) || kg <= 0 || kg > 1000 || Math.abs(Math.round(kg * 100) - kg * 100) > 1e-9) {
    problems.push('nominalFillKg');
  }
  return problems;
}
