import { describe, expect, it } from 'vitest';
import { balanceHandover, HandoverInputError, type HandoverLine } from './handover.js';

const line = (overrides: Partial<HandoverLine> = {}): HandoverLine => ({
  size: '13kg',
  fullsOut: 4,
  emptiesIn: 4,
  saleReports: 0,
  approvedExceptions: 0,
  ...overrides,
});

describe('balanceHandover', () => {
  it('is balanced when every full is matched by an empty', () => {
    const b = balanceHandover([line()]);
    expect(b.balanced).toBe(true);
    expect(b.totalShortfall).toBe(0);
  });

  it('records the uncovered fulls as the giver shortfall', () => {
    const b = balanceHandover([line({ emptiesIn: 1 })]);
    expect(b.balanced).toBe(false);
    expect(b.totalShortfall).toBe(3);
    expect(b.lines[0]?.coveredByEmpties).toBe(1);
  });

  it('lets sale reports and approved exceptions cover what empties did not', () => {
    const b = balanceHandover([line({ emptiesIn: 1, saleReports: 2, approvedExceptions: 1 })]);
    expect(b.balanced).toBe(true);
    expect(b.lines[0]).toMatchObject({ coveredBySales: 2, coveredByExceptions: 1, shortfall: 0 });
  });

  it('does not let an empty of one size cover a full of another', () => {
    const b = balanceHandover([
      line({ size: '13kg', fullsOut: 2, emptiesIn: 0 }),
      line({ size: '6kg', fullsOut: 0, emptiesIn: 2 }),
    ]);
    expect(b.totalShortfall).toBe(2);
    expect(b.lines[1]?.extraEmpties).toBe(2);
  });

  it('reports extra empties without treating them as cover', () => {
    const b = balanceHandover([line({ fullsOut: 2, emptiesIn: 5 })]);
    expect(b.balanced).toBe(true);
    expect(b.lines[0]?.extraEmpties).toBe(3);
  });

  it('rejects sale reports or exceptions beyond the uncovered fulls', () => {
    expect(() => balanceHandover([line({ emptiesIn: 4, saleReports: 1 })])).toThrow(HandoverInputError);
  });

  it('rejects negative or fractional counts', () => {
    expect(() => balanceHandover([line({ fullsOut: -1 })])).toThrow(HandoverInputError);
    expect(() => balanceHandover([line({ emptiesIn: 1.5 })])).toThrow(HandoverInputError);
  });

  it('rejects the same size listed twice', () => {
    expect(() => balanceHandover([line(), line()])).toThrow(HandoverInputError);
  });
});
