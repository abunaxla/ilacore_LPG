/**
 * Cylinder rules: tag numbers, sizes and safety holds.
 * See docs/drafts/cylinder-state-model.md. Dates without a time are ISO strings, "YYYY-MM-DD".
 */
import type { SafetyState } from './state.js';

/** Hold placed by QC or an inspector. Time never lifts it; only a recorded event does. */
export const SAFETY_HOLDS = ['none', 'quarantined', 'condemned'] as const;
export type SafetyHold = (typeof SAFETY_HOLDS)[number];

/** Why a tag was taken off a cylinder. A retired tag is never used again. */
export const TAG_RETIRE_REASONS = ['damaged', 'unreadable', 'lost', 'other'] as const;
export type TagRetireReason = (typeof TAG_RETIRE_REASONS)[number];

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

/** Today's date in Kenya (East Africa Time, UTC+3, no daylight saving). */
export function todayInKenya(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The safety dimension. Only a person changes it, by placing or lifting a hold; dates never do.
 * (Test dates and inspections belong to the maintenance module, which comes after custody and movement.)
 */
export function safetyState(hold: SafetyHold): SafetyState {
  return hold === 'none' ? 'eligible' : hold;
}

/** Whether a cylinder may go out, as far as safety goes: only while no hold is on it. */
export function isSafeToDispatch(hold: SafetyHold): boolean {
  return hold === 'none';
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
