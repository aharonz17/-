import type { ExtraComponentType, LineCategory } from "./types";

// קטלוג רכיבי שכר: קוד, שם ודגלי חבות. אין תקן ארצי לקודים – זו המספור של המערכת.
export type ComponentDef = {
  code: string;
  name: string;
  category: LineCategory;
  incomeTax: boolean;
  nationalInsurance: boolean;
  pension: boolean;
  overtimeBase: boolean;
};

const def = (code: string, name: string, category: LineCategory, f: Partial<Omit<ComponentDef, "code" | "name" | "category">> = {}): ComponentDef => ({
  code, name, category,
  incomeTax: f.incomeTax ?? (category === "earning" || category === "benefit"),
  nationalInsurance: f.nationalInsurance ?? (category === "earning" || category === "benefit"),
  pension: f.pension ?? false,
  overtimeBase: f.overtimeBase ?? false,
});

export const CORE = {
  BASE: def("001", "משכורת בסיס", "earning", { pension: true, overtimeBase: true }),
  REGULAR_HOURS: def("002", "שעות רגילות", "earning", { pension: true }),
  WORK_DAYS: def("003", "ימי עבודה", "earning", { pension: true }),
  UNPAID_ABSENCE: def("004", "היעדרות ללא תשלום", "earning", { pension: true }),
  SICK_UNPAID: def("005", "ניכוי ימי מחלה (חלק לא משולם)", "earning", { pension: true }),
  VACATION_PAY: def("010", "דמי חופשה", "earning", { pension: true }),
  SICK_PAY: def("011", "דמי מחלה", "earning", { pension: true }),
  HOLIDAY_PAY: def("012", "דמי חג", "earning", { pension: true }),
  OT125: def("020", "שעות נוספות 125%", "earning"),
  OT150: def("021", "שעות נוספות 150%", "earning"),
  REST150: def("022", "עבודה במנוחה שבועית 150%", "earning"),
  REST175: def("023", "ש\"נ במנוחה שבועית 175%", "earning"),
  REST200: def("024", "ש\"נ במנוחה שבועית 200%", "earning"),
  HOLIDAY150: def("025", "עבודה בחג 150%", "earning"),
  TRAVEL: def("030", "נסיעות", "earning"),
  RECOVERY: def("031", "דמי הבראה", "earning"),
  CAR: def("040", "שווי רכב", "benefit"),
  PHONE: def("041", "שווי טלפון נייד", "benefit"),
  STUDY_FUND_IMPUTED: def("042", "זקיפת קרן השתלמות מעל התקרה", "benefit", { nationalInsurance: false }),
  PENSION_IMPUTED: def("043", "זקיפת הפרשת מעסיק לפנסיה מעל התקרה", "benefit", { nationalInsurance: false }),
  INCOME_TAX: def("100", "מס הכנסה", "mandatory"),
  NI: def("101", "ביטוח לאומי", "mandatory"),
  HEALTH: def("102", "מס בריאות", "mandatory"),
  PENSION_EMP: def("110", "קרן פנסיה – עובד", "provident"),
  STUDY_EMP: def("111", "קרן השתלמות – עובד", "provident"),
  ER_NI: def("200", "ביטוח לאומי – מעסיק", "employer"),
  ER_PENSION: def("201", "פנסיה תגמולים – מעסיק", "employer"),
  ER_DISABILITY: def("202", "אובדן כושר עבודה – מעסיק", "employer"),
  ER_SEVERANCE: def("203", "פיצויים – מעסיק", "employer"),
  ER_STUDY: def("204", "קרן השתלמות – מעסיק", "employer"),
} as const;

export const EXTRA: Record<ExtraComponentType, ComponentDef> = {
  BONUS: def("050", "בונוס", "earning"),
  COMMISSION: def("051", "עמלות", "earning", { pension: true }),
  FIXED_SUPPLEMENT: def("052", "תוספת קבועה", "earning", { pension: true, overtimeBase: true }),
  GLOBAL_OVERTIME: def("053", "שעות נוספות גלובליות", "earning"),
  RESERVE_PAY: def("054", "תגמול מילואים", "earning", { pension: true }),
  NOTICE_PAY: def("055", "חלף הודעה מוקדמת", "earning"),
  VACATION_REDEMPTION: def("056", "פדיון חופשה", "earning"),
  CLOTHING: def("057", "ביגוד", "earning"),
  ADJUSTMENT: def("058", "הפרשים / תיקון", "earning"),
  ABSENCE_DEDUCTION: def("006", "ניכוי היעדרות", "earning", { pension: true }),
  OTHER_EARNING: def("059", "תשלום אחר", "earning"),
  MEAL_BENEFIT: def("044", "שווי ארוחות", "benefit"),
  GIFT_BENEFIT: def("045", "שווי מתנה", "benefit"),
  OTHER_BENEFIT: def("046", "שווי אחר", "benefit"),
  REIMBURSEMENT: def("060", "החזר הוצאות", "reimbursement", { incomeTax: false, nationalInsurance: false }),
  LOAN: def("300", "החזר הלוואה", "voluntary"),
  ADVANCE: def("301", "מקדמה", "voluntary"),
  UNION_FEE: def("302", "דמי ועד / ארגון", "voluntary"),
  GARNISHMENT: def("303", "עיקול", "voluntary"),
  OTHER_DEDUCTION: def("304", "ניכוי אחר", "voluntary"),
};

export const EXTRA_TYPES = Object.keys(EXTRA) as ExtraComponentType[];
