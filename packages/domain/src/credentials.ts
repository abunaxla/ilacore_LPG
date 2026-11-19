/**
 * Rules for passwords (web sign-in) and PINs (sign-in on a registered handheld only).
 * Hashing lives in the API. These are the policy checks, shared with the web app for instant feedback.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PIN_LENGTH = 6;

export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'contains_phone' | 'one_character';
export type PinProblem = 'not_six_digits' | 'repeated' | 'sequential' | 'common';

// Most-used passwords that pass a length check. Anything starting with one of these is refused too.
const COMMON_PASSWORDS = [
  'password', 'passw0rd', '123456789', 'qwertyuiop', 'qwerty123', 'iloveyou', 'admin', 'welcome',
  'letmein', 'monkey', 'football', 'baseball', 'sunshine', 'princess', 'dragon', 'master', 'superman',
  'trustno1', 'abc123', 'kenya', 'nairobi', 'mombasa', 'ilacore', 'safaricom', 'mpesa', 'changeme',
];

export function checkPassword(password: string, context: { phone?: string } = {}): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push('too_short');
  if (password.length > PASSWORD_MAX_LENGTH) problems.push('too_long');
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.some((c) => lower.startsWith(c))) problems.push('common');
  if (/^(.)\1*$/.test(password)) problems.push('one_character');
  if (context.phone) {
    const national = context.phone.replace(/\D/g, '').slice(-9);
    if (national.length === 9 && password.replace(/\D/g, '').includes(national)) problems.push('contains_phone');
  }
  return problems;
}

const COMMON_PINS = new Set(['123123', '112233', '121212', '696969', '101010', '200000', '199999', '000123']);

export function checkPin(pin: string): PinProblem[] {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return ['not_six_digits'];
  const problems: PinProblem[] = [];
  if (/^(\d)\1+$/.test(pin)) problems.push('repeated');
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) problems.push('sequential');
  if (COMMON_PINS.has(pin)) problems.push('common');
  return problems;
}

/** Failed sign-ins allowed before the account locks. */
export const LOCKOUT_THRESHOLD = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

/**
 * How long to lock an account after this many consecutive failures: 15 minutes at 5 failures,
 * doubling for every further 5, capped at 24 hours. Returns 0 below the threshold.
 */
export function lockoutDurationMs(consecutiveFailures: number): number {
  if (consecutiveFailures < LOCKOUT_THRESHOLD) return 0;
  const doublings = Math.floor((consecutiveFailures - LOCKOUT_THRESHOLD) / LOCKOUT_THRESHOLD);
  return Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
}