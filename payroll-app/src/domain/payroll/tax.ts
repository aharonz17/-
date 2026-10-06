import { D, Decimal, ZERO, round2 } from "../money";
import type { Bracket } from "../rules/types";

/** מס לפי מדרגות; multiplier = מספר חודשים (לשיטה המצטברת) */
export function bracketTax(income: Decimal.Value, brackets: Bracket[], multiplier = 1) {
  const x = D(income);
  let prev = ZERO;
  let tax = ZERO;
  const parts: { from: number; to: number | null; rate: number; taxable: number; tax: number }[] = [];
  for (const b of brackets) {
    const top = b.upTo === null ? null : D(b.upTo).times(multiplier);
    if (x.lte(prev)) break;
    const slice = (top === null ? x : Decimal.min(x, top)).minus(prev);
    if (slice.gt(0)) {
      const t = slice.times(b.rate);
      tax = tax.plus(t);
      parts.push({ from: prev.toNumber(), to: top?.toNumber() ?? null, rate: b.rate, taxable: round2(slice).toNumber(), tax: round2(t).toNumber() });
    }
    if (top === null) break;
    prev = top;
  }
  return { tax: round2(tax), parts };
}

export function marginalRate(income: Decimal.Value, brackets: Bracket[]) {
  const x = D(income);
  for (const b of brackets) if (b.upTo === null || x.lte(b.upTo)) return b.rate;
  return brackets[brackets.length - 1].rate;
}

/** חישוב דו-שלבי (מופחת/מלא) – ביטוח לאומי ומס בריאות */
export function twoTier(base: Decimal.Value, threshold: number, ceiling: number, low: number, high: number) {
  const b = Decimal.min(D(base), ceiling);
  const lowPart = Decimal.min(b, threshold);
  const highPart = Decimal.max(ZERO, b.minus(threshold));
  return {
    lowPart, highPart,
    amount: round2(lowPart.times(low).plus(highPart.times(high))),
  };
}
