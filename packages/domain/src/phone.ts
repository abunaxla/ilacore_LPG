/**
 * Kenyan mobile numbers, normalised to E.164 (+2547XXXXXXXX or +2541XXXXXXXX).
 * Phone numbers identify people (sign-in) and customers (SMS confirmation), so one person
 * must always end up with exactly one form of their number.
 */
const KENYAN_MOBILE = /^[17]\d{8}$/;

/** Returns the E.164 form, or null when the input isn't a Kenyan mobile number. */
export function normalizeKenyanPhone(input: string): string | null {
  const compact = input.replace(/[\s\-().]/g, '');
  let national: string;
  if (compact.startsWith('+254')) national = compact.slice(4);
  else if (compact.startsWith('254')) national = compact.slice(3);
  else if (compact.startsWith('0')) national = compact.slice(1);
  else national = compact;
  return KENYAN_MOBILE.test(national) ? `+254${national}` : null;
}