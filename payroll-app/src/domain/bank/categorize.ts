// סיווג תנועות עו"ש לפי מילות מפתח בתיאור (research/03 §3).
// ההתאמה לפי תת-מחרוזת ולא מחרוזת מלאה – כל בנק מקצר אחרת.

export type Category =
  | "SALARY" | "BENEFITS" | "TAX" | "TRANSFER" | "INSTANT_TRANSFER" | "RTGS" | "P2P"
  | "STANDING_ORDER" | "CARD_SETTLEMENT" | "DEBIT_CARD" | "CHECK_DEPOSIT" | "CHECK" | "CHECK_RETURNED"
  | "CASH_WITHDRAWAL" | "CASH_DEPOSIT" | "BANK_FEES" | "INTEREST_DEBIT" | "INTEREST_CREDIT"
  | "LOAN_REPAYMENT" | "LOAN_RECEIVED" | "MORTGAGE" | "DEPOSIT_INTERNAL" | "SECURITIES" | "FX"
  | "REVERSAL" | "RENT" | "UTILITIES" | "OTHER";

export const CATEGORY_LABELS: Record<Category, string> = {
  SALARY: "משכורת", BENEFITS: "קצבאות ביטוח לאומי", TAX: "מס / החזר מס", TRANSFER: "העברה",
  INSTANT_TRANSFER: "העברה מיידית", RTGS: "זה\"ב", P2P: "ביט / פייבוקס", STANDING_ORDER: "הוראת קבע",
  CARD_SETTLEMENT: "חיוב כרטיס אשראי (מרוכז)", DEBIT_CARD: "כרטיס דביט", CHECK_DEPOSIT: "הפקדת שיק",
  CHECK: "שיק", CHECK_RETURNED: "שיק חוזר", CASH_WITHDRAWAL: "משיכת מזומן", CASH_DEPOSIT: "הפקדת מזומן",
  BANK_FEES: "עמלות בנק", INTEREST_DEBIT: "ריבית חובה", INTEREST_CREDIT: "ריבית זכות",
  LOAN_REPAYMENT: "החזר הלוואה", LOAN_RECEIVED: "העמדת הלוואה", MORTGAGE: "משכנתא",
  DEPOSIT_INTERNAL: "פיקדון / חיסכון", SECURITIES: "ניירות ערך", FX: "מט\"ח", REVERSAL: "ביטול / תיקון",
  RENT: "שכר דירה", UTILITIES: "חשבונות (חשמל/מים/ארנונה)", OTHER: "אחר",
};

/** קטגוריות שהן העברה פנימית ולא הכנסה/הוצאה (כדי לא לספור פעמיים) */
export const INTERNAL_CATEGORIES: Category[] = ["CARD_SETTLEMENT", "DEPOSIT_INTERNAL"];

const RULES: { cat: Category; words: string[]; dir?: "CREDIT" | "DEBIT" }[] = [
  { cat: "REVERSAL", words: ["ביטול", "סטורנו"] },
  { cat: "CHECK_RETURNED", words: ["שיק חוזר", "החזרת שיק", "ש.חוזר", "צ'ק חוזר"] },
  { cat: "SALARY", words: ["משכורת", "מש\"כ", "משכ'", "שכר עבודה", "זיכוי מס\"ב"], dir: "CREDIT" },
  { cat: "BENEFITS", words: ["ב.ל.", "ביטוח לאומי", "בטוח לאומי", "קצבת", "דמי אבטלה", "דמי לידה"], dir: "CREDIT" },
  { cat: "TAX", words: ["מס הכנסה", "החזר מס", "רשות המסים"] },
  { cat: "MORTGAGE", words: ["משכנתא", "הלוואת דיור", "טפחות"] },
  { cat: "LOAN_RECEIVED", words: ["העמדת הלוואה", "הלוואה חדשה"], dir: "CREDIT" },
  { cat: "LOAN_REPAYMENT", words: ["פרעון הלוואה", "פירעון", "החזר הלוואה", "תשלום הלוואה", "הלוואה"] },
  { cat: "CARD_SETTLEMENT", words: ["ישראכרט", "ויזה כאל", "כאל", "מקס איט", "לאומי קארד", "אמריקן אקספרס", "דיינרס", "מסטרקרד", "כרטיסי אשראי"], dir: "DEBIT" },
  { cat: "P2P", words: ["bit", "ביט", "paybox", "פייבוקס", "פפר פיי", "pepper pay"] },
  { cat: "INSTANT_TRANSFER", words: ["העברה מיידית"] },
  { cat: "RTGS", words: ["זה\"ב", "rtgs", "העברה דחופה"] },
  { cat: "STANDING_ORDER", words: ["הוראת קבע", "הו\"ק", "הרשאה לחיוב"] },
  { cat: "UTILITIES", words: ["חברת החשמל", "חשמל", "מי ", "תאגיד מים", "ארנונה", "עירית", "עיריית", "בזק", "גז"] },
  { cat: "RENT", words: ["שכר דירה", "שכ\"ד", "שכירות"] },
  { cat: "CHECK_DEPOSIT", words: ["הפקדת שיק", "הפ' שיק", "הפקדה בצילום", "שיקים"], dir: "CREDIT" },
  { cat: "CHECK", words: ["שיק", "צ'ק", "משיכת שיק"], dir: "DEBIT" },
  { cat: "CASH_WITHDRAWAL", words: ["משיכת מזומן", "משיכה מבנקט", "כספומט", "מכשיר אוטומטי", "בנקט"], dir: "DEBIT" },
  { cat: "CASH_DEPOSIT", words: ["הפקדת מזומן", "הפקדה"], dir: "CREDIT" },
  { cat: "INTEREST_DEBIT", words: ["ריבית חובה", "ריבית על משיכת יתר"], dir: "DEBIT" },
  { cat: "INTEREST_CREDIT", words: ["ריבית זכות"], dir: "CREDIT" },
  { cat: "BANK_FEES", words: ["עמלה", "עמ' ", "דמי ניהול", "עמלת", "דמי כרטיס"] },
  { cat: "DEPOSIT_INTERNAL", words: ["פקדון", "פיקדון", "פק\"מ", "חסכון", "חיסכון"] },
  { cat: "SECURITIES", words: ["ני\"ע", "דיבידנד", "רווח הון"] },
  { cat: "FX", words: ["מט\"ח", "המרה", "חו\"ל", "swift"] },
  { cat: "DEBIT_CARD", words: ["כרטיס דביט", "רכישה בכרטיס"], dir: "DEBIT" },
  { cat: "TRANSFER", words: ["העברה", "העב'", "מס\"ב"] },
];

export function categorize(description: string, direction: "CREDIT" | "DEBIT"): Category {
  const d = ` ${description.toLowerCase()} `;
  for (const r of RULES) {
    if (r.dir && r.dir !== direction) continue;
    if (r.words.some((w) => d.includes(w.toLowerCase()))) return r.cat;
  }
  return "OTHER";
}
