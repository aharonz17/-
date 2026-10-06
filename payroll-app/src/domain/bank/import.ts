import type { CanonicalTxn } from "./statement";

// אשף ייבוא: זיהוי שורת כותרת → ניחוש מיפוי עמודות → החלה על הגריד → תנועות קנוניות + בעיות.

export type Cell = string | number | Date | null | undefined;
export type Grid = Cell[][];

export const CANONICAL_FIELDS = {
  transactionDate: "תאריך פעולה",
  valueDate: "תאריך ערך",
  description: "תיאור",
  details: "פרטים נוספים",
  reference: "אסמכתא",
  debit: "חובה",
  credit: "זכות",
  amount: "סכום (חיובי/שלילי)",
  balanceAfter: "יתרה לאחר פעולה",
  operationType: "סוג פעולה",
  counterpartyName: "צד נגדי – שם",
  counterpartyBank: "צד נגדי – בנק",
  counterpartyBranch: "צד נגדי – סניף",
  counterpartyAccount: "צד נגדי – חשבון",
} as const;

export type CanonicalField = keyof typeof CANONICAL_FIELDS;
/** field → אינדקס עמודה */
export type Mapping = Partial<Record<CanonicalField, number>>;
export type DateFormat = "auto" | "DMY" | "MDY" | "YMD";

const SYNONYMS: [CanonicalField, string[]][] = [
  ["valueDate", ["תאריך ערך", "ערך", "value date"]],
  ["transactionDate", ["תאריך", "תאריך פעולה", "תאריך ביצוע", "תאריך עסקה", "תאריך רישום", "date"]],
  ["balanceAfter", ["יתרה", "יתרה בש\"ח", "היתרה בש\"ח", "יתרה לאחר פעולה", "יתרה משוערכת", "יתרה בשח", "balance"]],
  ["debit", ["חובה", "בחובה", "חיוב", "סכום חובה", "debit"]],
  ["credit", ["זכות", "בזכות", "זיכוי", "סכום זכות", "credit"]],
  ["amount", ["סכום", "סכום פעולה", "סכום בש\"ח", "זכות/חובה", "₪ זכות/חובה", "amount"]],
  ["reference", ["אסמכתא", "אסמכתה", "מספר אסמכתא", "אסמכתא 1", "reference", "ref"]],
  ["operationType", ["סוג פעולה", "סוג תנועה", "קוד פעולה", "קוד"]],
  ["description", ["תיאור", "תיאור הפעולה", "תיאור פעולה", "הפעולה", "פירוט", "תאור", "description"]],
  ["details", ["פרטים", "הערה", "הערות", "פירוט נוסף", "פרטים נוספים", "לטובת", "עבור"]],
  ["counterpartyName", ["שם", "שם המוטב", "מוטב", "שם הצד הנגדי"]],
  ["counterpartyBank", ["בנק"]],
  ["counterpartyBranch", ["סניף"]],
  ["counterpartyAccount", ["חשבון", "מספר חשבון"]],
];

export const normHeader = (s: Cell) =>
  String(s ?? "").replace(/[‎‏‪-‮]/g, "").replace(/[״“”]/g, "\"").replace(/[׳’]/g, "'")
    .replace(/\s+/g, " ").trim().toLowerCase();

/** מוצא את שורת הכותרת ב-30 השורות הראשונות */
export function detectHeaderRow(grid: Grid): number {
  let best = -1, bestScore = 0;
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const cells = grid[r].map(normHeader);
    let score = 0;
    for (const [, syns] of SYNONYMS) if (cells.some((c) => syns.includes(c))) score++;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 2 ? best : 0;
}

/** ניחוש מיפוי: התאמה מדויקת קודם, אחר כך הכלה */
export function guessMapping(headers: Cell[]): Mapping {
  const h = headers.map(normHeader);
  const m: Mapping = {};
  const taken = new Set<number>();
  for (const pass of ["exact", "contains"] as const) {
    for (const [field, syns] of SYNONYMS) {
      if (m[field] !== undefined) continue;
      const idx = h.findIndex((c, i) => !taken.has(i) && c && syns.some((s) => (pass === "exact" ? c === s : c.includes(s))));
      if (idx >= 0) { m[field] = idx; taken.add(idx); }
    }
  }
  // אם יש חובה/זכות – לא צריך סכום, ולהפך
  if (m.debit !== undefined && m.credit !== undefined) delete m.amount;
  return m;
}

export function parseNumber(v: Cell): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  let s = String(v).replace(/[‎‏‪-‮\s₪]|ש"ח|nis/gi, "").replace(/,/g, "");
  if (!s || s === "-") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function parseDateCell(v: Cell, fmt: DateFormat = "auto"): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${p2(v.getUTCMonth() + 1)}-${p2(v.getUTCDate())}`;
  }
  if (typeof v === "number") {
    // מספר סידורי של Excel
    if (v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
    }
    return null;
  }
  const s = String(v).replace(/[‎‏‪-‮]/g, "").trim().split(/[ T]/)[0];
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!m) return null;
  let a = +m[1], b = +m[2];
  let y = +m[3];
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  let day = a, month = b;
  if (fmt === "MDY" || (fmt === "auto" && b > 12 && a <= 12)) { day = b; month = a; }
  if (fmt === "YMD") return null;
  return valid(y, month, day);
}

function valid(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${p2(m)}-${p2(d)}`;
}

export type ImportIssue = { row: number; level: "ERROR" | "WARNING" | "INFO"; message: string };
export type ImportedTxn = CanonicalTxn & { rowNumber: number };

const OPENING_WORDS = ["יתרת פתיחה", "יתרה קודמת", "יתרה מועברת", "יתרה לתחילת", "opening"];
const TOTAL_WORDS = ["סה\"כ", "סהכ", "total", "יתרת סגירה", "יתרה לסוף"];

export function applyMapping(grid: Grid, headerRow: number, mapping: Mapping, fmt: DateFormat = "auto") {
  const issues: ImportIssue[] = [];
  const txns: ImportedTxn[] = [];
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  const get = (row: Cell[], f: CanonicalField) => (mapping[f] === undefined ? undefined : row[mapping[f]!]);
  const str = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

  if (mapping.transactionDate === undefined) issues.push({ row: 0, level: "ERROR", message: "חסר מיפוי לעמודת תאריך." });
  if (mapping.amount === undefined && (mapping.debit === undefined || mapping.credit === undefined))
    issues.push({ row: 0, level: "ERROR", message: "יש למפות עמודת סכום אחת, או גם חובה וגם זכות." });
  if (issues.length) return { txns, issues, openingBalance, closingBalance };

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const rowNo = r + 1;
    if (row.every((c) => str(c) === "")) continue;
    const desc = [str(get(row, "description")), str(get(row, "details"))].filter(Boolean).join(" | ");
    const balance = parseNumber(get(row, "balanceAfter"));
    const dLow = desc.toLowerCase();

    let debit = 0, credit = 0;
    if (mapping.amount !== undefined) {
      const a = parseNumber(get(row, "amount"));
      if (a !== null) { if (a < 0) debit = -a; else credit = a; }
    } else {
      debit = Math.abs(parseNumber(get(row, "debit")) ?? 0);
      credit = Math.abs(parseNumber(get(row, "credit")) ?? 0);
    }
    const date = parseDateCell(get(row, "transactionDate"), fmt);

    if (OPENING_WORDS.some((w) => dLow.includes(w)) && !debit && !credit) {
      if (balance !== null) openingBalance = balance;
      issues.push({ row: rowNo, level: "INFO", message: `שורת יתרת פתיחה זוהתה (${balance ?? "ללא סכום"}).` });
      continue;
    }
    if (TOTAL_WORDS.some((w) => dLow.includes(w) || str(row[0]).includes(w)) && !date) {
      if (balance !== null) closingBalance = balance;
      issues.push({ row: rowNo, level: "INFO", message: "שורת סיכום דולגה." });
      continue;
    }
    if (!date) {
      issues.push({ row: rowNo, level: "WARNING", message: `תאריך לא מזוהה ("${str(get(row, "transactionDate"))}") – השורה דולגה.` });
      continue;
    }
    if (debit && credit) {
      issues.push({ row: rowNo, level: "ERROR", message: "בשורה יש גם חובה וגם זכות – השורה דולגה." });
      continue;
    }
    if (!debit && !credit) {
      issues.push({ row: rowNo, level: "WARNING", message: "שורה ללא סכום – דולגה." });
      continue;
    }
    if (!desc) issues.push({ row: rowNo, level: "WARNING", message: "שורה ללא תיאור." });
    const raw: Record<string, unknown> = {};
    row.forEach((c, i) => { raw[String(i)] = c instanceof Date ? c.toISOString() : c ?? null; });
    txns.push({
      rowNumber: rowNo,
      transactionDate: date,
      valueDate: parseDateCell(get(row, "valueDate"), fmt),
      amount: debit || credit,
      direction: credit ? "CREDIT" : "DEBIT",
      balanceAfter: balance,
      description: desc,
      reference: str(get(row, "reference")) || null,
      operationType: str(get(row, "operationType")) || null,
      counterpartyName: str(get(row, "counterpartyName")) || null,
      counterpartyBank: str(get(row, "counterpartyBank")) || null,
      counterpartyBranch: str(get(row, "counterpartyBranch")) || null,
      counterpartyAccount: str(get(row, "counterpartyAccount")) || null,
      raw,
    });
  }

  // חלק מהבנקים מייצאים מהחדש לישן – הופכים לסדר כרונולוגי
  if (txns.length > 1 && txns[0].transactionDate > txns[txns.length - 1].transactionDate) {
    txns.reverse();
    issues.push({ row: 0, level: "INFO", message: "הקובץ ממוין מהחדש לישן – הסדר הופך לכרונולוגי." });
  }
  return { txns, issues, openingBalance, closingBalance };
}
