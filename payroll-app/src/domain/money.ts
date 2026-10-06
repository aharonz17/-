import Decimal from "decimal.js";

// כל החישובים הכספיים עוברים דרך Decimal כדי להימנע משגיאות float.
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type Num = Decimal.Value;
export const D = (v: Num) => new Decimal(v);
export const ZERO = new Decimal(0);

/** עיגול לאגורה (2 ספרות), חצי כלפי מעלה */
export const round2 = (v: Num) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** מספר רגיל (לאחסון/תצוגה) מעוגל לאגורה */
export const toMoney = (v: Num) => round2(v).toNumber();

export const sum = (vals: Num[]) => vals.reduce<Decimal>((a, v) => a.plus(v), ZERO);
export const min = (...vals: Num[]) => Decimal.min(...vals);
export const max = (...vals: Num[]) => Decimal.max(...vals);

export function formatILS(v: Num | null | undefined, opts: { sign?: boolean } = {}) {
  if (v === null || v === undefined) return "";
  const n = new Decimal(v).toNumber();
  const s = n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return opts.sign && n > 0 ? `+${s}` : s;
}

export { Decimal };
