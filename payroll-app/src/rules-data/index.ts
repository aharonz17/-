import type { RuleVersion } from "@/domain/rules/types";

// נתוני כללים ראשוניים (seed). מקור: research/01-payroll-rules-israel.md.
// ערכים עם verified=false סומנו ⚠️ במחקר — המערכת מציגה אזהרה כשהם בשימוש.
// הוספת שנה חדשה = הוספת רשומות כאן (או דרך מסך הכללים), בלי לשנות את המנוע.

const TAX_BOOKLET_2026 = {
  name: "רשות המסים – לוח עזר לחישוב מס הכנסה ממשכורת 2026",
  url: "https://www.gov.il/BlobFolder/generalpage/income-tax-monthly-deductions-booklet/he/generalInformation_income-tax-monthly-deductions-booklet_monthly-deductions-booklet-2026.pdf",
};
const BTL_2026 = {
  name: "ביטוח לאומי – שינוי בתשלום דמי ביטוח לשנת 2026",
  url: "https://www.btl.gov.il/Insurance/Rates/Pages/%D7%9C%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%9D%20%D7%A9%D7%9B%D7%99%D7%A8%D7%99%D7%9D.aspx",
};
const KOL_MIN_WAGE = { name: "כל-זכות – שכר מינימום", url: "https://www.kolzchut.org.il/he/%D7%A9%D7%9B%D7%A8_%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D" };
const RESEARCH = { name: "מחקר פנימי research/01 (מתקצירי חיפוש)" };

export const RULES: RuleVersion[] = [
  // ───── מס הכנסה ─────
  {
    key: "income_tax.brackets", version: "2025", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", verified: true,
    source: { name: "רשות המסים – לוח עזר 2025" },
    payload: { monthly: [
      { upTo: 7010, rate: 0.10 }, { upTo: 10060, rate: 0.14 }, { upTo: 16150, rate: 0.20 },
      { upTo: 22440, rate: 0.31 }, { upTo: 46690, rate: 0.35 }, { upTo: 60130, rate: 0.47 }, { upTo: null, rate: 0.50 },
    ] },
    notes: "מדרגת 50% כוללת מס יסף 3%",
  },
  {
    key: "income_tax.brackets", version: "2026", effectiveFrom: "2026-01-01", effectiveTo: null, verified: true,
    source: { name: "תיקון 288 – ריווח מדרגות (רטרואקטיבי מ-1.1.2026)", url: TAX_BOOKLET_2026.url },
    payload: { monthly: [
      { upTo: 7010, rate: 0.10 }, { upTo: 10060, rate: 0.14 }, { upTo: 19000, rate: 0.20 },
      { upTo: 25100, rate: 0.31 }, { upTo: 46690, rate: 0.35 }, { upTo: 60130, rate: 0.47 }, { upTo: null, rate: 0.50 },
    ] },
    notes: "מדרגות 20% ו-31% רווחו; השאר מוקפאות",
  },
  {
    key: "credit_point.value", version: "2025", effectiveFrom: "2025-01-01", effectiveTo: null, verified: true,
    source: TAX_BOOKLET_2026, payload: { monthly: 242 }, notes: "מוקפא 2025–2027",
  },
  {
    key: "credit_points.personal", version: "base", effectiveFrom: "2020-01-01", effectiveTo: null, verified: true,
    source: TAX_BOOKLET_2026,
    payload: { resident: 2.25, woman: 0.5, singleParent: 1, alimonyOrRemarriage: 1, disabledChildPerChild: 2 },
  },
  {
    key: "credit_points.children", version: "base", effectiveFrom: "2022-01-01", effectiveTo: null, verified: false,
    source: { name: "כל-זכות – נקודות זיכוי להורה לפעוט", url: "https://www.kolzchut.org.il/he/%D7%A0%D7%A7%D7%95%D7%93%D7%95%D7%AA_%D7%96%D7%99%D7%9B%D7%95%D7%99_%D7%9E%D7%9E%D7%A1_%D7%94%D7%9B%D7%A0%D7%A1%D7%94_%D7%9C%D7%94%D7%95%D7%A8%D7%94_%D7%9C%D7%A4%D7%A2%D7%95%D7%98_(%D7%9E%D7%AA%D7%97%D7%AA_%D7%9C%D7%92%D7%99%D7%9C_6)" },
    payload: {
      mother: { "0": 1.5, "1-5": 2.5, "6-17": 1, "18": 0.5 },
      father: { "0": 1.5, "1-5": 2.5 },
    },
    notes: "אומת במחקר רק גיל 4–5 (2.5). שאר הגילאים – ידע כללי, לאמת מול לוח העזר",
  },
  {
    key: "credit_points.toddler_addition", version: "2024", effectiveFrom: "2024-01-01", effectiveTo: null, verified: false,
    source: { name: "חוק סיוע להורים לילדים עד גיל 3 (2024)", url: "https://www.ynet.co.il/economy/article/sj5dv6eta" },
    payload: { byAge: { "0": 1, "1-2": 2, "3": 1 } },
    notes: "לכל הורה. תוספת 6–17 (נקודה לכל הורה במבחן הכנסה) לא ממודלת – להוסיף ידנית",
  },
  {
    key: "credit_points.discharged_soldier", version: "base", effectiveFrom: "2020-01-01", effectiveTo: null, verified: true,
    source: TAX_BOOKLET_2026,
    payload: { months: 36, full: { points: 2, minServiceMonthsMale: 23, minServiceMonthsFemale: 22 }, partial: { points: 1, minServiceMonths: 12 } },
  },
  {
    key: "credit_points.degree", version: "base", effectiveFrom: "2020-01-01", effectiveTo: null, verified: true,
    source: TAX_BOOKLET_2026, payload: { bachelor: 1, master: 0.5 },
    notes: "בשנה שלאחר סיום התואר (שנה אחת)",
  },
  {
    key: "credit_points.new_immigrant", version: "2022", effectiveFrom: "2022-01-01", effectiveTo: null, verified: false,
    source: RESEARCH,
    payload: { periods: [ { fromMonth: 0, toMonth: 11, points: 1 }, { fromMonth: 12, toMonth: 29, points: 3 }, { fromMonth: 30, toMonth: 41, points: 2 } ] },
    notes: "לעולים מ-2022",
  },
  {
    key: "credit_points.reserve_combat", version: "2026", effectiveFrom: "2026-01-01", effectiveTo: null, verified: true,
    source: { name: "כל-זכות – נקודות זיכוי ללוחמי מילואים" },
    payload: { table: [
      { minDays: 30, points: 0.5 }, { minDays: 40, points: 0.75 }, { minDays: 50, points: 1 }, { minDays: 55, points: 1.25 },
      { minDays: 60, points: 1.5 }, { minDays: 65, points: 1.75 }, { minDays: 70, points: 2 }, { minDays: 75, points: 2.25 },
      { minDays: 80, points: 2.5 }, { minDays: 85, points: 2.75 }, { minDays: 90, points: 3 }, { minDays: 95, points: 3.25 },
      { minDays: 100, points: 3.5 }, { minDays: 105, points: 3.75 }, { minDays: 110, points: 4 },
    ] },
    notes: "לפי ימי שירות בשנה הקודמת",
  },

  // ───── ביטוח לאומי ובריאות ─────
  {
    key: "national_insurance.rates", version: "2025", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", verified: true,
    source: { name: "ביטוח לאומי – שיעורים 2025" },
    payload: { reducedThreshold: 7522, ceiling: 50695, averageWage: 12536,
      employee: { low: 0.0104, high: 0.07 }, health: { low: 0.0323, high: 0.0517 }, employer: { low: 0.0451, high: 0.076 } },
  },
  {
    key: "national_insurance.rates", version: "2026", effectiveFrom: "2026-01-01", effectiveTo: null, verified: false,
    source: BTL_2026,
    payload: { reducedThreshold: 7703, ceiling: 51910, averageWage: 13769,
      employee: { low: 0.0104, high: 0.07 }, health: { low: 0.0323, high: 0.0517 }, employer: { low: 0.0451, high: 0.076 } },
    notes: "ספים אומתו; שיעורי המעסיק 2026 הונחו זהים ל-2025",
  },

  // ───── שכר מינימום ושעות ─────
  {
    key: "min_wage", version: "2024-04", effectiveFrom: "2024-04-01", effectiveTo: "2025-03-31", verified: false,
    source: KOL_MIN_WAGE, payload: { monthly: 5880.02, hourly: 32.30, youthPct: { "0-15": 0.7, "16": 0.75, "17": 0.83 } },
  },
  {
    key: "min_wage", version: "2025-04", effectiveFrom: "2025-04-01", effectiveTo: "2026-03-31", verified: true,
    source: KOL_MIN_WAGE, payload: { monthly: 6247.67, hourly: 34.32, youthPct: { "0-15": 0.7, "16": 0.75, "17": 0.83 } },
  },
  {
    key: "min_wage", version: "2026-04", effectiveFrom: "2026-04-01", effectiveTo: null, verified: true,
    source: KOL_MIN_WAGE, payload: { monthly: 6443.85, hourly: 35.40, youthPct: { "0-15": 0.7, "16": 0.75, "17": 0.83 } },
  },
  {
    key: "work_hours", version: "2018", effectiveFrom: "2018-04-01", effectiveTo: null, verified: true,
    source: { name: "חוק שעות עבודה ומנוחה (42 ש\"ש)" },
    payload: { standardMonthlyHours: 182, weeklyHours: 42, dailyHours5: 8.6, dailyHours6: 8, workDaysPerMonth5: 21.67, workDaysPerMonth6: 25 },
  },
  {
    key: "overtime.rates", version: "base", effectiveFrom: "2000-01-01", effectiveTo: null, verified: true,
    source: { name: "חוק שעות עבודה ומנוחה" },
    payload: { first2: 1.25, after2: 1.5, rest: 1.5, restOtFirst2: 1.75, restOtAfter2: 2.0, holiday: 1.5 },
    notes: "175%/200% במנוחה – לפי הפרקטיקה",
  },

  // ───── זכויות ─────
  {
    key: "recovery_pay", version: "2024-07", effectiveFrom: "2024-07-01", effectiveTo: "2025-06-30", verified: true,
    source: { name: "צו הרחבה – דמי הבראה" },
    payload: { dayRate: { private: 418, public: 471.4 }, daysBySeniority: RECOVERY_DAYS() },
  },
  {
    key: "recovery_pay", version: "2025-07", effectiveFrom: "2025-07-01", effectiveTo: null, verified: true,
    source: { name: "צו הרחבה 18.8.2026 – דמי הבראה (רטרואקטיבי)" },
    payload: { dayRate: { private: 451.5, public: 511.6 }, daysBySeniority: RECOVERY_DAYS() },
  },
  {
    key: "vacation.accrual", version: "2016", effectiveFrom: "2017-01-01", effectiveTo: null, verified: false,
    source: { name: "חוק חופשה שנתית (תיקון 2016)", url: "https://www.gov.il/he/pages/annual-vacations" },
    payload: { table: [
      { fromYear: 1, days5: 12, days6: 14 }, { fromYear: 6, days5: 14, days6: 16 }, { fromYear: 7, days5: 15, days6: 18 },
      { fromYear: 8, days5: 16, days6: 19 }, { fromYear: 9, days5: 17, days6: 20 }, { fromYear: 10, days5: 18, days6: 21 },
      { fromYear: 11, days5: 19, days6: 22 }, { fromYear: 12, days5: 20, days6: 23 }, { fromYear: 13, days5: 20, days6: 24 },
    ] },
    notes: "ימי עבודה לשנים 11–14 בשבוע 5 ימים – לאמת",
  },
  {
    key: "sick.rules", version: "base", effectiveFrom: "2000-01-01", effectiveTo: null, verified: true,
    source: { name: "חוק דמי מחלה" }, payload: { accrualPerMonth: 1.5, maxDays: 90, payPctByDay: [0, 0.5, 0.5, 1] },
  },
  {
    key: "travel.cap", version: "2025", effectiveFrom: "2025-01-01", effectiveTo: null, verified: true,
    source: { name: "צו הרחבה – השתתפות בהוצאות נסיעה" }, payload: { dailyCap: 22.6 },
  },

  // ───── פנסיה וקרן השתלמות ─────
  {
    key: "pension.mandatory", version: "2017", effectiveFrom: "2017-01-01", effectiveTo: null, verified: true,
    source: { name: "צו הרחבה לביטוח פנסיוני מקיף" },
    payload: { employee: 0.06, employer: 0.065, severance: 0.06, waitingMonthsNoFund: 6, waitingMonthsWithFund: 3 },
  },
  {
    key: "pension.tax", version: "2025", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", verified: false,
    source: RESEARCH,
    payload: { creditRate: 0.35, maxEmployeeRateForCredit: 0.07, qualifyingIncomeCap: 9700, employerExemptRate: 0.075, employerExemptSalaryCap: 31340 },
    notes: "תקרת פטור מעסיק = 2.5 × שכר ממוצע (משוער)",
  },
  {
    key: "pension.tax", version: "2026", effectiveFrom: "2026-01-01", effectiveTo: null, verified: true,
    source: { name: "אנליסט / הראל – תקרות 2026" },
    payload: { creditRate: 0.35, maxEmployeeRateForCredit: 0.07, qualifyingIncomeCap: 9700, employerExemptRate: 0.075, employerExemptSalaryCap: 34425 },
  },
  {
    key: "study_fund", version: "base", effectiveFrom: "2016-01-01", effectiveTo: null, verified: true,
    source: { name: "תקרות קרן השתלמות (מוקפא)" }, payload: { salaryCap: 15712, employee: 0.025, employer: 0.075 },
  },
  {
    key: "car_benefit", version: "2025", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", verified: true,
    source: { name: "רשות המסים – שווי שימוש ברכב 2025" },
    payload: { rate: 0.0248, priceCap: 583100, greenReduction: { hybrid: 560, plugin: 1130, electric: 1350 } },
  },
  {
    key: "car_benefit", version: "2026", effectiveFrom: "2026-01-01", effectiveTo: null, verified: false,
    source: { name: "מלם שכר – עדכון שווי שימוש ברכב 2026" },
    payload: { rate: 0.0248, priceCap: 596860, greenReduction: { hybrid: 570, plugin: 1150, electric: 1380 } },
    notes: "התקרה אומתה; הפחתות רכב ירוק משוערות (מוצמדות למדד)",
  },
  {
    key: "phone_benefit", version: "base", effectiveFrom: "2010-01-01", effectiveTo: null, verified: true,
    source: { name: "תקנות שווי שימוש בטלפון נייד" }, payload: { maxMonthly: 105, pctOfCost: 0.5 },
  },
  {
    key: "secondary_employment", version: "base", effectiveFrom: "2020-01-01", effectiveTo: null, verified: true,
    source: TAX_BOOKLET_2026, payload: { maxRate: 0.47 },
  },
  {
    key: "severance", version: "2025", effectiveFrom: "2025-01-01", effectiveTo: null, verified: true,
    source: { name: "כל-זכות – פטור ממס על פיצויים" }, payload: { exemptPerYear: 13750, hourlyHoursPerMonth: 200 },
  },
];

function RECOVERY_DAYS() {
  return [
    { fromYear: 1, days: 5 }, { fromYear: 2, days: 6 }, { fromYear: 4, days: 7 },
    { fromYear: 11, days: 8 }, { fromYear: 16, days: 9 }, { fromYear: 20, days: 10 },
  ];
}
