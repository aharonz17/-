import { D, Decimal, ZERO, round2, toMoney } from "../money";

export type Direction = "CREDIT" | "DEBIT";

/** תנועת בנק קנונית – כל Adapter / ייבוא מחזיר את המבנה הזה */
export type CanonicalTxn = {
  transactionDate: string;
  valueDate: string | null;
  amount: number; // תמיד חיובי
  direction: Direction;
  balanceAfter: number | null; // יתרה מדווחת מהבנק (אם יש)
  description: string;
  reference: string | null;
  operationType?: string | null;
  counterpartyName?: string | null;
  counterpartyBank?: string | null;
  counterpartyBranch?: string | null;
  counterpartyAccount?: string | null;
  raw?: Record<string, unknown> | null;
};

export type StatementRow<T extends CanonicalTxn = CanonicalTxn> = T & {
  runningBalance: number;
  reconciliation: { ok: boolean; expected: number | null; reported: number | null; difference: number | null };
};

export type Statement<T extends CanonicalTxn = CanonicalTxn> = {
  from: string | null;
  to: string | null;
  openingBalance: number;
  rows: StatementRow<T>[];
  totalCredits: number;
  totalDebits: number;
  closingBalance: number;
  /** יתרת סגירה מדווחת (מהשורה האחרונה) */
  reportedClosing: number | null;
  errors: { row: number; expected: number; reported: number; difference: number }[];
  balanced: boolean;
};

const signed = (t: CanonicalTxn) => (t.direction === "CREDIT" ? D(t.amount) : D(t.amount).neg());

/** מיון לפי תאריך ביצוע ואז ערך – שמירה על הסדר המקורי בתוך אותו יום */
export function sortTxns<T extends CanonicalTxn & { seq?: number }>(txns: T[]) {
  return [...txns].sort((a, b) =>
    a.transactionDate.localeCompare(b.transactionDate) || (a.seq ?? 0) - (b.seq ?? 0));
}

/**
 * בניית דף חשבון: יתרת פתיחה → תנועות עם יתרה מתגלגלת → יתרת סגירה, ובדיקת reconciliation:
 *  previous_balance + credit − debit = reported_balance (לכל שורה עם יתרה מדווחת)
 *  opening + Σcredits − Σdebits = closing
 */
export function buildStatement<T extends CanonicalTxn>(opening: number, txns: T[], range: { from?: string | null; to?: string | null } = {}): Statement<T> {
  let bal = D(opening);
  let credits = ZERO, debits = ZERO;
  const errors: Statement["errors"] = [];
  const rows: StatementRow<T>[] = txns.map((t, i) => {
    bal = round2(bal.plus(signed(t)));
    if (t.direction === "CREDIT") credits = credits.plus(t.amount); else debits = debits.plus(t.amount);
    let rec: StatementRow["reconciliation"] = { ok: true, expected: toMoney(bal), reported: null, difference: null };
    if (t.balanceAfter !== null && t.balanceAfter !== undefined) {
      const diff = round2(D(t.balanceAfter).minus(bal));
      rec = { ok: diff.isZero(), expected: toMoney(bal), reported: t.balanceAfter, difference: toMoney(diff) };
      if (!diff.isZero()) {
        errors.push({ row: i + 1, expected: toMoney(bal), reported: t.balanceAfter, difference: toMoney(diff) });
        // ממשיכים מהיתרה המדווחת כדי שטעות אחת לא תגרור את כל השורות
        bal = D(t.balanceAfter);
      }
    }
    return { ...t, runningBalance: toMoney(bal), reconciliation: rec };
  });
  const closing = round2(D(opening).plus(credits).minus(debits));
  const last = [...txns].reverse().find((t) => t.balanceAfter !== null && t.balanceAfter !== undefined);
  return {
    from: range.from ?? txns[0]?.transactionDate ?? null,
    to: range.to ?? txns[txns.length - 1]?.transactionDate ?? null,
    openingBalance: opening,
    rows,
    totalCredits: toMoney(credits),
    totalDebits: toMoney(debits),
    closingBalance: toMoney(closing),
    reportedClosing: last?.balanceAfter ?? null,
    errors,
    balanced: errors.length === 0,
  };
}

/** הסקת יתרת פתיחה מהשורה הראשונה שיש לה יתרה מדווחת */
export function inferOpeningBalance(txns: CanonicalTxn[]): number | null {
  let delta: Decimal = ZERO;
  for (const t of txns) {
    delta = delta.plus(signed(t));
    if (t.balanceAfter !== null && t.balanceAfter !== undefined) return toMoney(D(t.balanceAfter).minus(delta));
  }
  return null;
}
