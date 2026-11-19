/**
 * Money is always an integer number of cents (KES). Never a floating-point amount.
 * The brand stops a plain number being passed where cents are expected.
 */
export type Cents = number & { readonly __brand: 'Cents' };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be a whole number of cents, got ${value}`);
  }
  return value as Cents;
}

export const ZERO: Cents = cents(0);

export function addCents(...values: readonly Cents[]): Cents {
  return cents(values.reduce((sum, v) => sum + v, 0));
}

export function multiplyCents(unit: Cents, quantity: number): Cents {
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError(`Quantity must be a whole number, got ${quantity}`);
  }
  return cents(unit * quantity);
}

/** Formats for display only, for example 412000.5 KES -> "KES 412,000.50". */
export function formatKes(value: Cents): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const shillings = Math.trunc(abs / 100).toLocaleString('en-KE');
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}KES ${shillings}.${fraction}`;
}
