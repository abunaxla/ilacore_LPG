/**
 * The balanced-handover rule (docs/design/custody-and-liability.md).
 *
 * For every full cylinder handed over, the giver must receive, at the handover, one of:
 *   - an empty of the same size, scanned in
 *   - a sale report (sold outright, so no empty will come back)
 *   - an approved exception ("empties owed", with approver and due date)
 * Anything not covered is the giver's shortfall.
 *
 * Cover is applied in that order: empties first, then sale reports, then approved exceptions.
 * Covers only apply within the same cylinder size.
 */

export interface HandoverLine {
  /** Cylinder size code, for example "13kg". */
  readonly size: string;
  readonly fullsOut: number;
  readonly emptiesIn: number;
  readonly saleReports: number;
  readonly approvedExceptions: number;
}

export interface HandoverLineBalance {
  readonly size: string;
  readonly fullsOut: number;
  readonly coveredByEmpties: number;
  readonly coveredBySales: number;
  readonly coveredByExceptions: number;
  /** Fulls with no cover: the giver's shortfall. */
  readonly shortfall: number;
  /** Empties beyond the fulls handed over (for example settling empties owed from earlier). */
  readonly extraEmpties: number;
}

export interface HandoverBalance {
  readonly lines: readonly HandoverLineBalance[];
  readonly totalFullsOut: number;
  readonly totalShortfall: number;
  readonly balanced: boolean;
}

export class HandoverInputError extends Error {
  override readonly name = 'HandoverInputError';
}

function requireCount(value: number, field: string, size: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HandoverInputError(`${field} for ${size} must be a whole number of 0 or more, got ${value}`);
  }
}

export function balanceHandover(lines: readonly HandoverLine[]): HandoverBalance {
  const seen = new Set<string>();
  const result = lines.map((line): HandoverLineBalance => {
    if (seen.has(line.size)) {
      throw new HandoverInputError(`Size ${line.size} appears more than once`);
    }
    seen.add(line.size);
    requireCount(line.fullsOut, 'fullsOut', line.size);
    requireCount(line.emptiesIn, 'emptiesIn', line.size);
    requireCount(line.saleReports, 'saleReports', line.size);
    requireCount(line.approvedExceptions, 'approvedExceptions', line.size);

    const coveredByEmpties = Math.min(line.emptiesIn, line.fullsOut);
    const afterEmpties = line.fullsOut - coveredByEmpties;

    // A sale report or exception can only cover a full that was actually handed over and not already covered.
    if (line.saleReports + line.approvedExceptions > afterEmpties) {
      throw new HandoverInputError(
        `${line.size}: ${line.saleReports} sale reports and ${line.approvedExceptions} exceptions, ` +
          `but only ${afterEmpties} fulls are left uncovered by empties`,
      );
    }

    const coveredBySales = line.saleReports;
    const coveredByExceptions = line.approvedExceptions;
    const shortfall = afterEmpties - coveredBySales - coveredByExceptions;

    return {
      size: line.size,
      fullsOut: line.fullsOut,
      coveredByEmpties,
      coveredBySales,
      coveredByExceptions,
      shortfall,
      extraEmpties: Math.max(0, line.emptiesIn - line.fullsOut),
    };
  });

  const totalFullsOut = result.reduce((n, l) => n + l.fullsOut, 0);
  const totalShortfall = result.reduce((n, l) => n + l.shortfall, 0);
  return { lines: result, totalFullsOut, totalShortfall, balanced: totalShortfall === 0 };
}
