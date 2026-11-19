import { addCents, multiplyCents, type Cents } from './money.js';

/** Price per cylinder size, effective on a date. G = gas price, C = cylinder value. */
export interface SizePrice {
  readonly gas: Cents;
  readonly cylinder: Cents;
}

export type SaleKind = 'exchange' | 'outright';

/** Exchange = G. Outright sale = G + C (bought, no refund, no deposit). */
export function unitPrice(price: SizePrice, kind: SaleKind): Cents {
  return kind === 'exchange' ? price.gas : addCents(price.gas, price.cylinder);
}

export function linePrice(price: SizePrice, kind: SaleKind, quantity: number): Cents {
  return multiplyCents(unitPrice(price, kind), quantity);
}
