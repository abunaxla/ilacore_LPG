import { describe, expect, it } from 'vitest';
import { addCents, cents, formatKes, multiplyCents } from './money.js';
import { linePrice, unitPrice } from './pricing.js';

describe('money', () => {
  it('only accepts whole cents', () => {
    expect(() => cents(10.5)).toThrow(RangeError);
    expect(cents(1050)).toBe(1050);
  });

  it('adds and multiplies exactly', () => {
    expect(addCents(cents(10), cents(20), cents(5))).toBe(35);
    expect(multiplyCents(cents(310_000), 4)).toBe(1_240_000);
  });

  it('formats KES for display', () => {
    expect(formatKes(cents(41_200_050))).toBe('KES 412,000.50');
    expect(formatKes(cents(-5))).toBe('-KES 0.05');
  });
});

describe('pricing', () => {
  const price = { gas: cents(310_000), cylinder: cents(450_000) };

  it('charges G for an exchange and G + C for an outright sale', () => {
    expect(unitPrice(price, 'exchange')).toBe(310_000);
    expect(unitPrice(price, 'outright')).toBe(760_000);
    expect(linePrice(price, 'outright', 2)).toBe(1_520_000);
  });
});
