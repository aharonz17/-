// קובץ זיכויים במבנה מס"ב (רשומות ברוחב 128 תווים + CRLF).
// ⚠️ המבנה נבנה לפי ידע כללי על מפרט הזיכויים של מס"ב ולא אומת מול המפרט הרשמי
// (https://www.masav.co.il/ts_download). לפני העלאה לבנק – יש לבדוק מול המפרט / נציג הבנק.
// המערכת אינה שולחת את הקובץ לשום מקום – הוא להורדה בלבד.

export const MASAV_VERIFIED = false;

export type MasavPayment = {
  bankCode: string;
  branch: string;
  account: string;
  idNumber: string;
  name: string;
  amount: number; // ₪
  reference: string;
  periodFrom: { year: number; month: number };
  periodTo: { year: number; month: number };
};

export type MasavBatch = {
  institutionCode: string; // קוד מוסד/נושא (8)
  senderCode: string; // מוסד שולח (5)
  institutionName: string;
  paymentDate: string; // YYYY-MM-DD
  createdDate: string;
  serial?: number;
  payments: MasavPayment[];
};

const num = (v: string | number, len: number) => {
  const s = String(v).replace(/\D/g, "");
  if (s.length > len) throw new Error(`ערך ${v} ארוך מ-${len} ספרות`);
  return s.padStart(len, "0");
};
const txt = (v: string, len: number) => toCp862(v).slice(0, len).padEnd(len, " ");
const yymmdd = (d: string) => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
const yymm = (p: { year: number; month: number }) => String(p.year).slice(2) + String(p.month).padStart(2, "0");
const agorot = (v: number) => Math.round(v * 100);

/** קוד עמוד 862 (עברית DOS): א-ת → 0x80–0x9A. מוחזר כמחרוזת של תווים בודדים בבתים אלו. */
function toCp862(s: string) {
  return [...s].map((c) => {
    const code = c.charCodeAt(0);
    if (code >= 0x05d0 && code <= 0x05ea) return String.fromCharCode(0x80 + (code - 0x05d0));
    if (code < 128) return c;
    return " ";
  }).join("");
}

export function buildMasavFile(b: MasavBatch): { content: Buffer; total: number; count: number; warnings: string[] } {
  const warnings: string[] = [];
  const serial = num(b.serial ?? 1, 3);
  const records: string[] = [];
  // רשומת כותרת K
  records.push("K" + num(b.institutionCode, 8) + "00" + yymmdd(b.paymentDate) + "0" + serial + "0" + yymmdd(b.createdDate) +
    num(b.senderCode, 5) + "000000" + txt(b.institutionName, 30) + " ".repeat(56) + "KOT");
  let total = 0;
  for (const p of b.payments) {
    if (p.bankCode.length > 2) warnings.push(`קוד בנק ${p.bankCode} בן 3 ספרות – לא נתמך בפורמט הישן.`);
    total += agorot(p.amount);
    records.push("1" + num(b.institutionCode, 8) + "00" + "000000" + num(p.bankCode, 2) + num(p.branch, 3) + "0000" +
      num(p.account, 9) + "0" + num(p.idNumber, 9) + txt(p.name, 16) + num(agorot(p.amount), 13) + txt(p.reference, 20) +
      yymm(p.periodFrom) + yymm(p.periodTo) + "000" + "006" + "0".repeat(18) + "  ");
  }
  // רשומת סיכום 5
  records.push("5" + num(b.institutionCode, 8) + "00" + yymmdd(b.paymentDate) + "0" + serial + num(total, 15) + "0".repeat(15) +
    num(b.payments.length, 7) + "0".repeat(7) + " ".repeat(63));
  records.push("9".repeat(128));
  for (const r of records) if (r.length !== 128) throw new Error(`רשומה באורך ${r.length} במקום 128`);
  const content = Buffer.from(records.map((r) => r + "\r\n").join(""), "latin1");
  return { content, total: total / 100, count: b.payments.length, warnings };
}
