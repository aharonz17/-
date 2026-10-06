// מודל הקלט והפלט של מנוע השכר. הכל נתונים טהורים (JSON), בלי תלות ב-DB או ב-UI.

export type PayType = "monthly" | "hourly" | "daily";
export type Gender = "male" | "female";
export type Sector = "private" | "public";

export type ChildFact = { birthDate: string; disabled?: boolean };

export type TaxFacts = {
  resident: boolean;
  singleParent?: boolean;
  alimonyOrRemarriage?: boolean;
  children?: ChildFact[];
  dischargedSoldier?: { dischargeDate: string; serviceMonths: number } | null;
  degree?: { type: "bachelor" | "master"; completionYear: number } | null;
  newImmigrant?: { aliyahDate: string } | null;
  reserveCombatDaysPrevYear?: number;
  /** יישוב מזכה: שיעור זיכוי ותקרת הכנסה שנתית */
  settlement?: { name?: string; rate: number; annualIncomeCap: number } | null;
  /** נקודות ידניות נוספות (למשל תוספת 6–17, אישור פקיד שומה) */
  additionalPoints?: number;
  additionalPointsNote?: string;
};

export type TaxSettings = {
  method: "monthly" | "cumulative";
  /** תיאום מס / שיעור קבוע לפי אישור */
  override?: { rate: number; applyCredits: boolean; note?: string } | null;
};

export type PensionSettings = {
  enabled: boolean;
  employeeRate: number;
  employerRate: number;
  severanceRate: number;
  /** אובדן כושר עבודה על חשבון המעסיק (נוסף ל-employerRate) */
  disabilityRate?: number;
  /** תאריך תחילת הפרשה; אם חסר – מחושב לפי תקופת ההמתנה */
  startDate?: string | null;
  hasExistingFund?: boolean;
  provider?: string;
  product?: string;
};

export type StudyFundSettings = {
  enabled: boolean;
  employeeRate: number;
  employerRate: number;
  /** true = הפרשה עד תקרת הפטור בלבד; false = על מלוא השכר, והעודף נזקף */
  capAtCeiling: boolean;
};

export type CarSettings = {
  listPrice: number;
  kind: "regular" | "hybrid" | "plugin" | "electric";
  employeeContribution?: number;
};

export type Attendance = {
  workDays: number;
  regularHours?: number;
  ot125?: number;
  ot150?: number;
  rest150?: number;
  rest175?: number;
  rest200?: number;
  holiday150?: number;
  vacationDays?: number;
  /** כל רצף מחלה: מספר ימים בחודש הזה; continuesFromDay = כמה ימים כבר היו ברצף לפני החודש */
  sickEpisodes?: { days: number; continuesFromDay?: number }[];
  unpaidDays?: number;
  /** דמי חג לעובד שעתי/יומי */
  holidayPaidDays?: number;
};

export type ExtraComponentType =
  | "BONUS" | "COMMISSION" | "FIXED_SUPPLEMENT" | "GLOBAL_OVERTIME" | "RESERVE_PAY" | "NOTICE_PAY"
  | "VACATION_REDEMPTION" | "CLOTHING" | "ADJUSTMENT" | "OTHER_EARNING"
  | "MEAL_BENEFIT" | "GIFT_BENEFIT" | "OTHER_BENEFIT"
  | "REIMBURSEMENT"
  | "LOAN" | "ADVANCE" | "UNION_FEE" | "GARNISHMENT" | "OTHER_DEDUCTION";

export type ExtraComponent = {
  type: ExtraComponentType;
  description?: string;
  amount?: number;
  quantity?: number;
  rate?: number;
};

export type YtdTotals = {
  months: number;
  gross: number;
  taxableIncome: number;
  incomeTax: number;
  creditsAmount: number;
  niEmployee: number;
  health: number;
  pensionEmployee: number;
};

export type PayrollInput = {
  period: { year: number; month: number };
  paymentDate?: string;
  employer: { sector: Sector };
  employee: { birthDate?: string | null; gender: Gender };
  employment: {
    startDate: string;
    endDate?: string | null;
    payType: PayType;
    baseSalary?: number;
    hourlyRate?: number;
    dailyRate?: number;
    jobPercent: number;
    workWeekDays: 5 | 6;
    standardMonthlyHours?: number;
    isMainEmployer: boolean;
    hasForm101: boolean;
    priorSeniorityMonths?: number;
  };
  taxFacts: TaxFacts;
  taxSettings: TaxSettings;
  pension?: PensionSettings | null;
  studyFund?: StudyFundSettings | null;
  car?: CarSettings | null;
  phone?: { monthlyCost: number; employeePaid?: number } | null;
  travel?: { dailyFare: number; monthlyPass?: number | null } | null;
  recovery?: { mode: "none" | "monthly" | "manual"; days?: number } | null;
  attendance: Attendance;
  components?: ExtraComponent[];
  balances?: { vacationOpening?: number; sickOpening?: number };
  ytd?: YtdTotals | null;
};

export type LineCategory = "earning" | "benefit" | "mandatory" | "provident" | "voluntary" | "employer" | "reimbursement";

export type PayslipLine = {
  code: string;
  name: string;
  category: LineCategory;
  quantity?: number;
  rate?: number;
  pct?: number;
  amount: number;
  ruleIds?: string[];
};

export type TraceStep = {
  section: string;
  label: string;
  formula: string;
  amount: number;
  ruleIds?: string[];
};

export type Message = { level: "ERROR" | "WARNING" | "INFO"; code: string; text: string };

export type BalanceResult = { opening: number; accrued: number; used: number; closing: number };

export type PayrollResult = {
  period: { year: number; month: number };
  lines: PayslipLine[];
  bases: { tax: number; ni: number; pension: number; studyFund: number; overtimeHourValue: number };
  tax: {
    method: "monthly" | "cumulative" | "override" | "max_rate";
    beforeCredits: number;
    creditPoints: number;
    creditPointsBreakdown: { label: string; points: number; ruleId?: string }[];
    creditPointsAmount: number;
    pensionCredit: number;
    settlementCredit: number;
    incomeTax: number;
    marginalRate: number;
  };
  ni: { base: number; employee: number; health: number; employer: number };
  pension: { base: number; employee: number; employer: number; disability: number; severance: number; active: boolean };
  studyFund: { base: number; employee: number; employer: number; imputed: number; active: boolean };
  totals: {
    grossPay: number;
    benefits: number;
    reimbursements: number;
    mandatoryDeductions: number;
    providentDeductions: number;
    voluntaryDeductions: number;
    totalDeductions: number;
    net: number;
    netToPay: number;
    employerCost: number;
  };
  balances: { vacation: BalanceResult; sick: BalanceResult };
  info: {
    ageYears: number | null;
    seniorityMonths: number;
    seniorityYears: number;
    hourValue: number;
    dayValue: number;
    recoveryEntitlementDays: number;
    minWageMonthly: number;
    minWageHourly: number;
  };
  ytd: YtdTotals;
  trace: TraceStep[];
  messages: Message[];
  rulesUsed: { id: string; key: string; version: string; verified: boolean; source: string }[];
};
