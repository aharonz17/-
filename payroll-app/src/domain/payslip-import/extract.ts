import type { Line, TextItem } from "./layout";
import { buildLines } from "./layout";

// זיהוי שדות בתלוש שכר מתוך שורות טקסט. התלושים שונים מספק לספק (חילן, מיכפל, מלם…),
// לכן מחפשים לפי תוויות נפוצות ולוקחים את הערך שאחריהן (באותה שורה) או מתחתיהן.
// כל שדה מוחזר עם רמת ביטחון ושורת המקור – המשתמש מאשר/מתקן במסך.

export type Confidence = "high" | "low";
export type Field<T> = { value: T; confidence: Confidence; source: string } | null;

export type ExtractedPayslip = {
  employerName: Field<string>;
  employerCompanyId: Field<string>;
  deductionsFile: Field<string>;
  period: Field<{ year: number; month: number }>;
  employeeName: Field<string>;
  idNumber: Field<string>;
  employeeNumber: Field<string>;
  startDate: Field<string>;
  birthDate: Field<string>;
  jobPercent: Field<number>;
  maritalStatus: Field<string>;
  gender: Field<"male" | "female">;
  creditPoints: Field<number>;
  baseSalary: Field<number>;
  hourlyRate: Field<number>;
  hours: Field<number>;
  workDays: Field<number>;
  ot125: Field<number>;
  ot150: Field<number>;
  travel: Field<number>;
  recovery: Field<number>;
  bonus: Field<number>;
  carBenefit: Field<number>;
  gross: Field<number>;
  taxable: Field<number>;
  pensionBase: Field<number>;
  incomeTax: Field<number>;
  nationalInsurance: Field<number>;
  health: Field<number>;
  pensionEmployee: Field<number>;
  studyFundEmployee: Field<number>;
  pensionEmployer: Field<number>;
  severance: Field<number>;
  studyFundEmployer: Field<number>;
  totalDeductions: Field<number>;
  net: Field<number>;
  netToPay: Field<number>;
  vacationBalance: Field<number>;
  sickBalance: Field<number>;
  bankCode: Field<string>;
  branch: Field<string>;
  account: Field<string>;
};

type Tok = { t: string; norm: string; item: TextItem; line: number };
type Kind = "money" | "number" | "date" | "period" | "id" | "text";

const HEB = /[֐-׿]/;
const norm = (s: string) => s.replace(/[()]/g, "").replace(/[״"“”]/g, "\"").replace(/[׳'’`]/g, "'").replace(/[:·•|]/g, "").trim();
const isMoney = (s: string) => /^-?\(?[\d,]*\d\.\d{2}\)?-?$/.test(s.replace(/₪/g, ""));
const isNumber = (s: string) => /^-?[\d,]*\.?\d+%?-?$/.test(s);
const isDate = (s: string) => /^\d{1,2}[/.-]\d{1,2}[/.-](\d{2}|\d{4})$/.test(s);
const isPeriod = (s: string) => /^(0?[1-9]|1[0-2])[/.-](20\d{2})$/.test(s);
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

export const parseAmount = (s: string) => {
  let x = s.replace(/[₪,\s]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(x)) { neg = true; x = x.slice(1, -1); }
  if (x.endsWith("-")) { neg = true; x = x.slice(0, -1); }
  if (x.startsWith("-")) { neg = !neg; x = x.slice(1); }
  x = x.replace(/%$/, "");
  const n = Number(x);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};

export function validIsraeliId(id: string) {
  const s = id.replace(/\D/g, "");
  if (!s || s.length > 9 || /^0+$/.test(s)) return false;
  const p = s.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(p[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

const toIsoDate = (s: string) => {
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += y > 50 ? 1900 : 2000;
  const mo = +m[2], d = +m[1];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

function matches(kind: Kind, t: string) {
  switch (kind) {
    case "money": return isMoney(t) || (isNumber(t) && !t.endsWith("%"));
    case "number": return isNumber(t);
    case "date": return isDate(t);
    case "period": return isPeriod(t);
    case "id": return /^\d{5,9}$/.test(t);
    case "text": return HEB.test(t);
  }
}

class Doc {
  toks: Tok[][];
  constructor(public lines: Line[]) {
    this.toks = lines.map((l, li) => l.items.flatMap((item) =>
      item.str.split(/\s+/).filter(Boolean).map((t) => ({ t: t.replace(/^[:·]+|[:·]+$/g, ""), norm: norm(t), item, line: li }))).filter((x) => x.t !== "" && x.t !== "₪" && x.norm !== ""));
  }

  /** מוצא את כל מופעי התווית: [שורה, אינדקס אחרי התווית] */
  find(label: string, exclude?: RegExp): { li: number; end: number; start: number }[] {
    const words = norm(label).split(/\s+/);
    const out: { li: number; end: number; start: number }[] = [];
    this.toks.forEach((toks, li) => {
      for (let i = 0; i + words.length <= toks.length; i++) {
        let ok = true;
        for (let k = 0; k < words.length; k++) {
          const tn = toks[i + k].norm;
          const w = words[k];
          if (!(tn === w || (k === words.length - 1 && tn.startsWith(w)) || (words.length === 1 && tn.replace(/^[והבלמש]/, "") === w))) { ok = false; break; }
        }
        if (!ok) continue;
        const after = toks.slice(i + words.length, i + words.length + 3).map((x) => x.norm).join(" ");
        if (exclude && exclude.test(after)) continue;
        out.push({ li, end: i + words.length, start: i });
      }
    });
    return out;
  }

  /**
   * ערך אחרי התווית באותה שורה; אם אין – מתחת לתווית (תיבות סיכום).
   * pick: first = הערך הראשון; lastMoney = שורת טבלה (תיאור… כמות תעריף סכום) – הסכום האחרון ברצף;
   * lastNumber = המספר האחרון ברצף (יתרות: פתיחה צבירה ניצול סגירה).
   */
  valueAfter(labels: string[], kind: Kind, opts: { exclude?: RegExp; pick?: "first" | "lastMoney" | "lastNumber"; below?: boolean } = {}): Field<string> {
    const pick = opts.pick ?? "first";
    for (const label of labels) {
      for (const hit of this.find(label, opts.exclude)) {
        const toks = this.toks[hit.li];
        const run: Tok[] = [];
        let skippedHeb = 0;
        for (let j = hit.end; j < toks.length; j++) {
          const t = toks[j].t;
          const heb = HEB.test(t) && !/^(ש"ח|שח|ימים|שעות|שנים|נק')$/.test(norm(t));
          if (kind === "text") {
            if (!HEB.test(t) || (/:$/.test(toks[j].item.str.trim()) && run.length)) break;
            run.push(toks[j]);
            if (/:$/.test(t) || run.length >= 4) break;
            continue;
          }
          if (heb) {
            // בשורת טבלה מדלגים על המשך התיאור עד הסכום; אחרי שהתחיל רצף מספרים – עברית מסיימת אותו
            if (run.length || pick === "first" || ++skippedHeb > 6) break;
            continue;
          }
          if (matches(kind, t)) run.push(toks[j]);
        }
        if (run.length) {
          if (kind === "text") {
            const v = run.map((r) => r.t).join(" ").replace(/:$/, "");
            return { value: v, confidence: "high", source: this.lines[hit.li].text };
          }
          let chosen = run[0];
          if (pick === "lastMoney") chosen = [...run].reverse().find((r) => isMoney(r.t)) ?? run[run.length - 1];
          if (pick === "lastNumber") chosen = run[run.length - 1];
          return { value: chosen.t, confidence: skippedHeb > 2 ? "low" : "high", source: this.lines[hit.li].text };
        }
        if (opts.below !== false) {
          const lab = toks[hit.start].item;
          const cx = lab.x + lab.w / 2;
          for (let d = 1; d <= 2 && hit.li + d < this.toks.length; d++) {
            const cand = this.toks[hit.li + d].filter((x) => (kind === "money" ? isMoney(x.t) : matches(kind, x.t)) && Math.abs(x.item.x + x.item.w / 2 - cx) < Math.max(40, lab.w));
            if (cand.length) return { value: cand[0].t, confidence: "low", source: `${this.lines[hit.li].text} ↓ ${this.lines[hit.li + d].text}` };
          }
        }
      }
    }
    return null;
  }
}

const num = (f: Field<string>): Field<number> => {
  if (!f) return null;
  const v = parseAmount(f.value);
  return v === null ? null : { ...f, value: v };
};

export function extractPayslip(items: TextItem[]): { fields: ExtractedPayslip; lines: string[] } {
  const lines = buildLines(items);
  const d = new Doc(lines);
  const ER = /מעסיק|מעביד/;
  const YTD = /מצטבר|מתחילת/;
  const money = (labels: string[], exclude?: RegExp) => num(d.valueAfter(labels, "money", { pick: "lastMoney", exclude }));

  // תקופה
  let period: Field<{ year: number; month: number }> = null;
  const p = d.valueAfter(["לחודש", "תלוש שכר", "חודש", "תקופה"], "period");
  if (p) {
    const [m, y] = p.value.split(/[/.-]/).map(Number);
    period = { value: { year: y, month: m }, confidence: "high", source: p.source };
  } else {
    for (const l of lines) {
      const mi = MONTHS.findIndex((m) => l.text.includes(m));
      const y = l.text.match(/20\d{2}/);
      if (mi >= 0 && y) { period = { value: { year: +y[0], month: mi + 1 }, confidence: "low", source: l.text }; break; }
    }
  }

  // ת"ז – לפי תווית, ואם לא נמצא: כל מספר 9 ספרות עם ספרת ביקורת תקינה
  let idNumber = d.valueAfter(["מספר זהות", "ת.ז", "ת\"ז", "תעודת זהות", "מס' זהות", "זהות"], "id");
  if (idNumber && !validIsraeliId(idNumber.value)) idNumber = { ...idNumber, confidence: "low" };
  if (!idNumber) {
    for (const l of lines) for (const it of l.items) {
      const m = it.str.match(/\b\d{9}\b/);
      if (m && validIsraeliId(m[0])) { idNumber = { value: m[0], confidence: "low", source: l.text }; break; }
    }
  }
  if (idNumber) idNumber = { ...idNumber, value: idNumber.value.padStart(9, "0") };

  const date = (labels: string[]): Field<string> => {
    const f = d.valueAfter(labels, "date");
    const iso = f && toIsoDate(f.value);
    return f && iso ? { ...f, value: iso } : null;
  };

  // מצב משפחתי ומגדר
  let maritalStatus: Field<string> = null, gender: Field<"male" | "female"> = null;
  const MS: [RegExp, string, "male" | "female" | null][] = [
    [/רווקה/, "single", "female"], [/נשואה/, "married", "female"], [/גרושה/, "divorced", "female"], [/אלמנה/, "widowed", "female"],
    [/רווק\b|רווק$/, "single", "male"], [/נשוי\b|נשוי$/, "married", "male"], [/גרוש\b|גרוש$/, "divorced", "male"], [/אלמן\b|אלמן$/, "widowed", "male"],
    [/רווק\/ה/, "single", null], [/נשוי\/אה/, "married", null], [/גרוש\/ה/, "divorced", null],
  ];
  for (const l of lines) {
    for (const [re, ms, g] of MS) {
      if (re.test(l.text)) {
        maritalStatus ??= { value: ms, confidence: "low", source: l.text };
        if (g) gender ??= { value: g, confidence: "low", source: l.text };
      }
    }
  }
  const genderLine = lines.find((l) => /מין|מגדר/.test(l.text) && /(זכר|נקבה)/.test(l.text));
  if (genderLine) gender = { value: /נקבה/.test(genderLine.text) ? "female" : "male", confidence: "high", source: genderLine.text };

  // שם מעסיק: שורה עם בע"מ / השורה הראשונה
  let employerName: Field<string> = null;
  const corp = lines.slice(0, 12).find((l) => /בע"מ|בע״מ|בעמ|עמותה|שותפות/.test(l.text));
  const first = lines.find((l) => HEB.test(l.text));
  if (corp) {
    const it = corp.items.find((i) => /בע"מ|בע״מ|בעמ|עמותה|שותפות/.test(i.str)) ?? corp.items[0];
    employerName = { value: it.str.replace(/^(שם המעסיק|מעסיק|שם מעביד|מעביד)[:\s]*/, "").replace(/[:·].*$/, "").trim().slice(0, 80), confidence: "low", source: corp.text };
  }
  else if (first) employerName = { value: first.items[0].str.slice(0, 80), confidence: "low", source: first.text };

  const bank = d.valueAfter(["בנק"], "number", { exclude: /ניכויים/, below: false });
  const fields: ExtractedPayslip = {
    employerName,
    employerCompanyId: d.valueAfter(["ח.פ", "ח\"פ", "ע.מ", "עוסק מורשה", "מספר חברה", "ח.פ/ע.מ"], "id", { below: false }),
    deductionsFile: d.valueAfter(["תיק ניכויים", "תיק במס הכנסה", "תיק ניכוי", "מס' תיק ניכויים"], "id", { below: false }),
    period,
    employeeName: d.valueAfter(["שם העובד", "שם עובד", "שם"], "text", { below: false, exclude: /מעסיק|בנק|קופה|קרן/ }),
    idNumber,
    employeeNumber: d.valueAfter(["מספר עובד", "מס' עובד", "מס עובד", "עובד מס"], "number", { below: false }),
    startDate: date(["תחילת עבודה", "תאריך תחילת עבודה", "ת. תחילה", "תאריך תחילה", "תחילת העסקה", "ת.התחלה"]),
    birthDate: date(["תאריך לידה", "ת. לידה", "ת.לידה"]),
    jobPercent: num(d.valueAfter(["היקף משרה", "חלקיות משרה", "אחוז משרה", "% משרה", "חלקיות"], "number")),
    maritalStatus,
    gender,
    creditPoints: num(d.valueAfter(["נקודות זיכוי", "נק' זיכוי", "נק זיכוי", "זיכוי אישי"], "number", { exclude: /סכום/ })),
    baseSalary: money(["משכורת בסיס", "שכר בסיס", "משכורת חודשית", "שכר יסוד", "משכורת"], /ברוטו|לתשלום|מינימום|נטו/),
    hourlyRate: num(d.valueAfter(["ערך שעה", "תעריף שעה", "שכר שעה", "תעריף לשעה"], "money", { below: false })),
    hours: num(d.valueAfter(["שעות רגילות", "שעות עבודה", "סה\"כ שעות"], "number")),
    workDays: num(d.valueAfter(["ימי עבודה", "ימים בפועל"], "number")),
    ot125: num(d.valueAfter(["שעות נוספות 125%", "ש\"נ 125%", "ש.נ 125%", "125%"], "number", { exclude: YTD })),
    ot150: num(d.valueAfter(["שעות נוספות 150%", "ש\"נ 150%", "ש.נ 150%", "150%"], "number", { exclude: YTD })),
    travel: money(["נסיעות", "דמי נסיעה", "החזר נסיעות"]),
    recovery: money(["דמי הבראה", "הבראה"], /זכאות|ימים|יתרה/),
    bonus: money(["בונוס", "פרמיה", "מענק"]),
    carBenefit: money(["שווי רכב", "שווי שימוש ברכב", "רכב"], /השתתפות/),
    gross: money(["סה\"כ תשלומים", "סך תשלומים", "שכר ברוטו", "ברוטו", "סה\"כ ברוטו"], YTD),
    taxable: money(["שכר חייב במס", "הכנסה חייבת", "שכר חייב", "חייב במס"], YTD),
    pensionBase: money(["שכר לזכויות פנסיוניות", "שכר לזכויות", "שכר מבוטח", "שכר לפנסיה", "שכר קובע לפנסיה"], YTD),
    incomeTax: money(["מס הכנסה"], /מצטבר|שולי|חייב/),
    nationalInsurance: money(["ביטוח לאומי", "ב\"ל", "בטוח לאומי"], new RegExp(`${ER.source}|${YTD.source}|תיק|בריאות`)),
    health: money(["מס בריאות", "דמי בריאות", "ביטוח בריאות"], YTD),
    pensionEmployee: money(["קרן פנסיה", "פנסיה עובד", "תגמולי עובד", "גמל עובד", "פנסיה", "ביטוח מנהלים"], new RegExp(`${ER.source}|${YTD.source}|פיצויים|זיכוי|לזכויות`)),
    studyFundEmployee: money(["קרן השתלמות", "קה\"ש", "השתלמות"], new RegExp(`${ER.source}|זקיפת|לקרן`)),
    pensionEmployer: money(["פנסיה תגמולים – מעסיק", "תגמולי מעסיק", "תגמולים מעסיק", "פנסיה מעסיק"]),
    severance: money(["פיצויים"], /פטור/),
    studyFundEmployer: money(["קרן השתלמות – מעסיק", "השתלמות מעסיק", "קה\"ש מעסיק"]),
    totalDeductions: money(["סה\"כ ניכויים", "סך ניכויים", "ניכויים"], /חובה|רשות|קופות/),
    netToPay: money(["נטו לתשלום", "סכום לתשלום", "לתשלום"]),
    net: money(["שכר נטו", "נטו"], /^לתשלום/),
    vacationBalance: num(d.valueAfter(["יתרת חופשה", "חופשה (ימים)", "יתרה חופשה"], "number", { pick: "lastNumber", below: false })),
    sickBalance: num(d.valueAfter(["יתרת מחלה", "מחלה (ימים)", "יתרה מחלה"], "number", { pick: "lastNumber", below: false })),
    bankCode: bank,
    branch: d.valueAfter(["סניף"], "number", { below: false }),
    account: d.valueAfter(["חשבון", "מס' חשבון", "מספר חשבון"], "id", { below: false }),
  };

  // ערכים כספיים שליליים/אפס בשדות שלא יכולים להיות כאלה – כנראה זיהוי שגוי
  for (const k of ["baseSalary", "gross", "pensionBase", "netToPay", "net", "hourlyRate"] as const) {
    const f = fields[k];
    if (f && !(f.value > 0)) fields[k] = null;
  }
  if (fields.jobPercent && fields.jobPercent.value > 0 && fields.jobPercent.value <= 1) fields.jobPercent = { ...fields.jobPercent, value: fields.jobPercent.value * 100 };
  if (fields.bankCode && !/^\d{1,3}$/.test(fields.bankCode.value)) fields.bankCode = null;
  if (!fields.bankCode) {
    for (const l of lines) {
      const b = BANK_NAMES.find(([re]) => re.test(l.text));
      if (b && /בנק|חשבון|העברה/.test(l.text)) { fields.bankCode = { value: b[1], confidence: "low", source: l.text }; break; }
    }
  }
  return { fields, lines: lines.map((l) => l.text) };
}

const BANK_NAMES: [RegExp, string][] = [
  [/לאומי(?! קארד)/, "10"], [/הפועלים/, "12"], [/דיסקונט/, "11"], [/מרכנתיל/, "17"], [/מזרחי|טפחות/, "20"], [/יהב/, "04"],
  [/הבינלאומי/, "31"], [/אוצר החייל/, "14"], [/מסד/, "46"], [/פאג"י|פועלי אגודת/, "52"], [/בנק ירושלים/, "54"], [/וואן זירו|one zero/i, "18"], [/הדואר/, "09"],
];

export const FIELD_LABELS: Record<keyof ExtractedPayslip, string> = {
  employerName: "שם המעסיק", employerCompanyId: "ח.פ מעסיק", deductionsFile: "תיק ניכויים", period: "חודש התלוש", employeeName: "שם העובד",
  idNumber: "ת.ז", employeeNumber: "מספר עובד", startDate: "תחילת עבודה", birthDate: "תאריך לידה", jobPercent: "היקף משרה", maritalStatus: "מצב משפחתי",
  gender: "מגדר", creditPoints: "נקודות זיכוי", baseSalary: "שכר בסיס", hourlyRate: "ערך שעה", hours: "שעות", workDays: "ימי עבודה",
  ot125: "ש\"נ 125% (שעות)", ot150: "ש\"נ 150% (שעות)", travel: "נסיעות", recovery: "הבראה", bonus: "בונוס", carBenefit: "שווי רכב", gross: "ברוטו",
  taxable: "שכר חייב במס", pensionBase: "שכר לפנסיה", incomeTax: "מס הכנסה", nationalInsurance: "ביטוח לאומי", health: "מס בריאות", pensionEmployee: "פנסיה עובד",
  studyFundEmployee: "קרן השתלמות עובד", pensionEmployer: "פנסיה מעסיק", severance: "פיצויים", studyFundEmployer: "השתלמות מעסיק",
  totalDeductions: "סה\"כ ניכויים", net: "נטו", netToPay: "נטו לתשלום", vacationBalance: "יתרת חופשה", sickBalance: "יתרת מחלה",
  bankCode: "בנק", branch: "סניף", account: "חשבון",
};
