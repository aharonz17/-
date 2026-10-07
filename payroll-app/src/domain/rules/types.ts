// מנוע הכללים: כל ערך כספי/שיעור מגיע מרשומת כלל עם תקופת תוקף ומקור.

export type Bracket = { upTo: number | null; rate: number };

export type RulePayloads = {
  "income_tax.brackets": { monthly: Bracket[] };
  "credit_point.value": { monthly: number };
  "credit_points.personal": {
    resident: number;
    woman: number;
    singleParent: number;
    alimonyOrRemarriage: number;
    disabledChildPerChild: number;
  };
  /** נקודות לילד לפי גיל בשנת המס (שנת המס פחות שנת הלידה). key = גיל או טווח "a-b" */
  "credit_points.children": { mother: Record<string, number>; father: Record<string, number> };
  /** תוספות 2024 לפעוטות (לכל הורה) */
  "credit_points.toddler_addition": { byAge: Record<string, number> };
  "credit_points.discharged_soldier": {
    months: number;
    full: { points: number; minServiceMonthsMale: number; minServiceMonthsFemale: number };
    partial: { points: number; minServiceMonths: number };
  };
  "credit_points.degree": { bachelor: number; master: number };
  /** עולה חדש: נקודות לפי חודשים מהעלייה */
  "credit_points.new_immigrant": { periods: { fromMonth: number; toMonth: number; points: number }[] };
  /** לוחמי מילואים: נקודות לפי ימי שירות בשנה הקודמת */
  "credit_points.reserve_combat": { table: { minDays: number; points: number }[] };
  "national_insurance.rates": {
    reducedThreshold: number;
    ceiling: number;
    employee: { low: number; high: number };
    health: { low: number; high: number };
    employer: { low: number; high: number };
    averageWage: number;
  };
  "min_wage": { monthly: number; hourly: number; youthPct: Record<string, number> };
  "work_hours": { standardMonthlyHours: number; weeklyHours: number; dailyHours5: number; dailyHours6: number; workDaysPerMonth5: number; workDaysPerMonth6: number };
  "overtime.rates": { first2: number; after2: number; rest: number; restOtFirst2: number; restOtAfter2: number; holiday: number };
  "recovery_pay": { dayRate: { private: number; public: number }; daysBySeniority: { fromYear: number; days: number }[] };
  "vacation.accrual": { table: { fromYear: number; days5: number; days6: number }[] };
  "sick.rules": { accrualPerMonth: number; maxDays: number; payPctByDay: number[] };
  "travel.cap": { dailyCap: number };
  "pension.mandatory": { employee: number; employer: number; severance: number; waitingMonthsNoFund: number; waitingMonthsWithFund: number };
  "pension.tax": { creditRate: number; maxEmployeeRateForCredit: number; qualifyingIncomeCap: number; employerExemptRate: number; employerExemptSalaryCap: number };
  "study_fund": { salaryCap: number; employee: number; employer: number };
  "car_benefit": { rate: number; priceCap: number; greenReduction: { hybrid: number; plugin: number; electric: number } };
  "phone_benefit": { maxMonthly: number; pctOfCost: number };
  "secondary_employment": { maxRate: number };
  "severance": { exemptPerYear: number; hourlyHoursPerMonth: number };
};

export type RuleKey = keyof RulePayloads;

export type RuleSource = { name: string; url?: string };

export type RuleVersion<K extends RuleKey = RuleKey> = {
  key: K;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // כולל
  version: string;
  payload: RulePayloads[K];
  source: RuleSource;
  verified: boolean;
  notes?: string;
};

export type ResolvedRule<K extends RuleKey> = RuleVersion<K> & { id: string };

export type RuleSet = {
  date: string;
  get<K extends RuleKey>(key: K): ResolvedRule<K>;
  all(): ResolvedRule<RuleKey>[];
};
