import { D } from "../money";
import { monthsBetween } from "../payroll/dates";

// מנוע התאמות: האם תשלום שכר מתאים לתנועת בנק. התוצאה חייבת להיות מוסברת.

export type MatchStatus = "CONFIRMED" | "VERY_LIKELY" | "POSSIBLE" | "UNMATCHED";

export type PaymentLike = {
  id: number;
  amount: number;
  paymentDate: string; // תאריך התשלום המתוכנן
  period: { year: number; month: number };
  beneficiaryName: string;
  employerName: string;
  reference: string | null;
  bank?: string | null;
  branch?: string | null;
  account?: string | null;
};

export type TxnLike = {
  id: number;
  transactionDate: string;
  valueDate: string | null;
  amount: number;
  direction: "CREDIT" | "DEBIT";
  description: string;
  reference: string | null;
  counterpartyName?: string | null;
  accountBank?: string | null;
  accountBranch?: string | null;
  accountNumber?: string | null;
};

export type MatchResult = { paymentId: number; txnId: number; score: number; status: MatchStatus; reasons: string[] };

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const norm = (s: string | null | undefined) => (s ?? "").replace(/["'״׳.\-]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");

function nameMatch(name: string, text: string) {
  const n = norm(name);
  if (!n) return 0;
  const t = norm(text);
  if (t.includes(n)) return 1;
  const words = n.split(" ").filter((w) => w.length >= 2);
  if (!words.length) return 0;
  const hit = words.filter((w) => t.includes(w)).length;
  return hit / words.length;
}

export function scoreMatch(p: PaymentLike, t: TxnLike): MatchResult {
  const reasons: string[] = [];
  let score = 0;
  const amountDiff = D(p.amount).minus(t.amount).abs();
  if (amountDiff.isZero()) { score += 50; reasons.push("סכום זהה"); }
  else if (amountDiff.lte(1)) { score += 35; reasons.push(`הפרש סכום קטן (${amountDiff.toFixed(2)} ₪)`); }
  else return { paymentId: p.id, txnId: t.id, score: 0, status: "UNMATCHED", reasons: ["הסכום שונה"] };

  if (t.direction === "CREDIT") { score += 5; reasons.push("תנועת זכות"); }

  const date = t.valueDate ?? t.transactionDate;
  const dd = Math.abs(dayDiff(date, p.paymentDate));
  if (dd === 0) { score += 20; reasons.push("אותו תאריך"); }
  else if (dd <= 2) { score += 16; reasons.push(`תאריך בהפרש ${dd} ימים`); }
  else if (dd <= 7) { score += 8; reasons.push(`תאריך בהפרש ${dd} ימים`); }
  else {
    // חלון חוקי: עד ה-9 לחודש שאחרי חודש השכר (מורחב ל-1–12)
    const d = new Date(date);
    const afterPeriod = monthsBetween(`${p.period.year}-${String(p.period.month).padStart(2, "0")}-01`, date);
    if (afterPeriod >= 1 && afterPeriod < 2 && d.getUTCDate() <= 12) { score += 5; reasons.push("בחלון תשלום השכר (תחילת החודש שאחרי)"); }
    else score -= 10;
  }

  const text = `${t.description} ${t.counterpartyName ?? ""}`;
  const emp = nameMatch(p.employerName, text);
  const ben = nameMatch(p.beneficiaryName, text);
  if (emp >= 0.99) { score += 12; reasons.push("שם המעסיק בתיאור"); }
  else if (emp >= 0.5) { score += 6; reasons.push("חלק משם המעסיק בתיאור"); }
  if (ben >= 0.99) { score += 10; reasons.push("שם המוטב בתיאור"); }
  else if (ben >= 0.5) { score += 5; reasons.push("חלק משם המוטב בתיאור"); }
  if (/משכורת|שכר|מש"כ|מס"ב/.test(t.description)) { score += 5; reasons.push("תיאור מסוג משכורת"); }

  if (p.reference && (norm(t.reference).includes(norm(p.reference)) || norm(t.description).includes(norm(p.reference)))) {
    score += 15; reasons.push("אסמכתא תואמת");
  }
  if (p.account && t.accountNumber && digits(p.account) === digits(t.accountNumber) && (!p.bank || !t.accountBank || digits(p.bank) === digits(t.accountBank))) {
    score += 10; reasons.push("חשבון המוטב תואם");
  }

  score = Math.max(0, Math.min(100, score));
  const status: MatchStatus = score >= 85 && amountDiff.isZero() ? "CONFIRMED" : score >= 70 ? "VERY_LIKELY" : score >= 50 ? "POSSIBLE" : "UNMATCHED";
  return { paymentId: p.id, txnId: t.id, score, status, reasons };
}

/** התאמה גלובלית: הכי טובות קודם, כל תשלום ותנועה לכל היותר פעם אחת */
export function matchPayments(payments: PaymentLike[], txns: TxnLike[]): MatchResult[] {
  const all: MatchResult[] = [];
  for (const p of payments) for (const t of txns) {
    const m = scoreMatch(p, t);
    if (m.status !== "UNMATCHED") all.push(m);
  }
  all.sort((a, b) => b.score - a.score);
  const usedP = new Set<number>(), usedT = new Set<number>();
  const out: MatchResult[] = [];
  for (const m of all) {
    if (usedP.has(m.paymentId) || usedT.has(m.txnId)) continue;
    usedP.add(m.paymentId); usedT.add(m.txnId);
    out.push(m);
  }
  return out;
}
