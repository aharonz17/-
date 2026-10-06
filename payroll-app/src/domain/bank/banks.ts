// מרשם הבנקים בישראל. קוד הבנק נשמר כמחרוזת (בנק ישראל מרחיב ל-3 ספרות).
// group = בנקים שחולקים מערכת מחשוב – ולכן גם מבנה ייצוא דומה.

export type BankInfo = {
  code: string;
  name: string;
  group: string;
  active: boolean;
  verified: boolean;
  notes?: string;
};

export const BANKS: BankInfo[] = [
  { code: "10", name: "בנק לאומי", group: "leumi", active: true, verified: true },
  { code: "12", name: "בנק הפועלים", group: "hapoalim", active: true, verified: true },
  { code: "11", name: "בנק דיסקונט", group: "discount", active: true, verified: true },
  { code: "17", name: "בנק מרכנתיל", group: "discount", active: true, verified: true },
  { code: "20", name: "בנק מזרחי-טפחות", group: "mizrahi", active: true, verified: true },
  { code: "04", name: "בנק יהב", group: "mizrahi", active: true, verified: true },
  { code: "31", name: "הבנק הבינלאומי הראשון", group: "fibi", active: true, verified: true },
  { code: "14", name: "בנק אוצר החייל", group: "fibi", active: true, verified: true },
  { code: "46", name: "בנק מסד", group: "fibi", active: true, verified: true },
  { code: "52", name: "בנק פאג\"י", group: "fibi", active: true, verified: true },
  { code: "54", name: "בנק ירושלים", group: "jerusalem", active: true, verified: true },
  { code: "18", name: "וואן זירו", group: "onezero", active: true, verified: true },
  { code: "03", name: "בנק אש (esh)", group: "esh", active: true, verified: false, notes: "קוד לא אומת" },
  { code: "09", name: "בנק הדואר", group: "post", active: true, verified: true },
  { code: "13", name: "בנק איגוד (מוזג)", group: "mizrahi", active: false, verified: true },
  { code: "26", name: "יובנק (מוזג)", group: "fibi", active: false, verified: false },
  { code: "34", name: "בנק ערבי ישראלי (מוזג)", group: "leumi", active: false, verified: false },
];

export const bankByCode = (code: string | null | undefined) => BANKS.find((b) => b.code === normalizeBankCode(code));

export function normalizeBankCode(code: string | number | null | undefined) {
  if (code === null || code === undefined) return "";
  const s = String(code).trim();
  return /^\d$/.test(s) ? `0${s}` : s;
}

/** IBAN ישראלי: IL + 2 ספרות ביקורת + 3 בנק + 3 סניף + 13 חשבון (23 תווים) */
export function buildIban(bank: string, branch: string, account: string) {
  const bban = bank.padStart(3, "0") + branch.padStart(3, "0") + account.replace(/\D/g, "").padStart(13, "0");
  const check = 98 - mod97(bban + "182100"); // I=18 L=21 + "00"
  return `IL${String(check).padStart(2, "0")}${bban}`;
}

export function validateIban(iban: string) {
  const s = iban.replace(/\s/g, "").toUpperCase();
  if (!/^IL\d{21}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(digits) === 1;
}

function mod97(digits: string) {
  let r = 0;
  for (const ch of digits) r = (r * 10 + Number(ch)) % 97;
  return r;
}
