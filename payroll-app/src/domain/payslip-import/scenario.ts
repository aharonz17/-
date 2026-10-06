import type { ExtractedPayslip } from "./extract";
import type { ExtraComponent, PayrollInput } from "../payroll/types";

// תרחיש לסימולטור: הנתונים שמזינים/משנים, והמרה לקלט של מנוע השכר.

export type Scenario = {
  year: number;
  month: number;
  gender: "male" | "female";
  birthDate: string;
  startDate: string;
  payType: "monthly" | "hourly";
  baseSalary: number;
  hourlyRate: number;
  hours: number;
  jobPercent: number;
  workDays: number;
  creditPoints: number;
  ot125: number;
  ot150: number;
  travel: number;
  recovery: number;
  bonus: number;
  otherEarnings: number;
  carBenefit: number;
  pensionEnabled: boolean;
  pensionEmployee: number; // %
  pensionEmployer: number; // %
  severance: number; // %
  studyFundEnabled: boolean;
  studyFundEmployee: number; // %
  studyFundEmployer: number; // %
  sector: "private" | "public";
};

export type ActualValues = Partial<Record<"gross" | "taxable" | "incomeTax" | "nationalInsurance" | "health" | "pensionEmployee" | "studyFundEmployee" | "totalDeductions" | "net" | "netToPay" | "pensionEmployer" | "severance" | "studyFundEmployer", number>>;

const snap = (pct: number, options: number[]) => {
  const best = options.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a));
  return Math.abs(best - pct) <= 0.35 ? best : +pct.toFixed(2);
};

export const blankScenario = (year: number, month: number): Scenario => ({
  year, month, gender: "male", birthDate: "1990-01-01", startDate: `${year - 2}-01-01`, payType: "monthly",
  baseSalary: 10000, hourlyRate: 0, hours: 0, jobPercent: 100, workDays: 21, creditPoints: 2.25,
  ot125: 0, ot150: 0, travel: 0, recovery: 0, bonus: 0, otherEarnings: 0, carBenefit: 0,
  pensionEnabled: true, pensionEmployee: 6, pensionEmployer: 6.5, severance: 6,
  studyFundEnabled: false, studyFundEmployee: 2.5, studyFundEmployer: 7.5, sector: "private",
});

export function scenarioFromExtracted(f: ExtractedPayslip, fallback: { year: number; month: number }): { scenario: Scenario; actual: ActualValues } {
  const v = <T>(x: { value: T } | null, d: T) => (x ? x.value : d);
  const period = v(f.period, fallback);
  const s = blankScenario(period.year, period.month);
  s.gender = v(f.gender, s.gender);
  s.birthDate = v(f.birthDate, s.birthDate);
  s.startDate = v(f.startDate, s.startDate);
  s.jobPercent = v(f.jobPercent, 100);
  s.creditPoints = v(f.creditPoints, s.gender === "female" ? 2.75 : 2.25);
  s.workDays = v(f.workDays, 21);
  const base = v(f.baseSalary, 0);
  if (!base && f.hourlyRate && f.hours) {
    s.payType = "hourly";
    s.hourlyRate = f.hourlyRate.value;
    s.hours = f.hours.value;
    s.baseSalary = 0;
  } else {
    s.baseSalary = base || v(f.gross, 10000);
  }
  s.ot125 = v(f.ot125, 0);
  s.ot150 = v(f.ot150, 0);
  s.travel = v(f.travel, 0);
  s.recovery = v(f.recovery, 0);
  s.bonus = v(f.bonus, 0);
  s.carBenefit = v(f.carBenefit, 0);
  // רכיבים שלא זוהו: ההפרש בין הברוטו בתלוש לרכיבים שזוהו (בלי ש"נ, שערכן מחושב מחדש)
  const gross = v(f.gross, 0);
  const known = (s.payType === "monthly" ? s.baseSalary : s.hourlyRate * s.hours) + s.travel + s.recovery + s.bonus;
  // חיובי = רכיבים נוספים; שלילי = כנראה ניכוי היעדרות (מחלה/חופשה ללא תשלום), שמקטין גם את השכר לפנסיה
  if (gross && Math.abs(gross - known) > 1 && !s.ot125 && !s.ot150) s.otherEarnings = +(gross - known).toFixed(2);

  const pensionBase = v(f.pensionBase, 0) || (s.payType === "monthly" ? s.baseSalary : s.hourlyRate * s.hours) + Math.min(0, s.otherEarnings);
  if (f.pensionEmployee && pensionBase) {
    s.pensionEnabled = true;
    s.pensionEmployee = snap((f.pensionEmployee.value / pensionBase) * 100, [5.5, 6, 6.5, 7]);
  } else if (!f.pensionEmployee && f.gross) s.pensionEnabled = false;
  if (f.pensionEmployer && pensionBase) s.pensionEmployer = snap((f.pensionEmployer.value / pensionBase) * 100, [6.5, 7, 7.5]);
  if (f.severance && pensionBase) s.severance = snap((f.severance.value / pensionBase) * 100, [6, 8.33]);
  if (f.studyFundEmployee) {
    s.studyFundEnabled = true;
    const sfBase = Math.min(pensionBase, 15712);
    s.studyFundEmployee = snap((f.studyFundEmployee.value / sfBase) * 100, [2.5]);
    if (f.studyFundEmployer) s.studyFundEmployer = snap((f.studyFundEmployer.value / sfBase) * 100, [7.5]);
  }

  const actual: ActualValues = {};
  for (const k of ["gross", "taxable", "incomeTax", "nationalInsurance", "health", "pensionEmployee", "studyFundEmployee", "totalDeductions", "net", "netToPay", "pensionEmployer", "severance", "studyFundEmployer"] as const) {
    const fv = f[k];
    if (fv) actual[k] = fv.value;
  }
  return { scenario: s, actual };
}

export function scenarioToInput(s: Scenario): PayrollInput {
  const components: ExtraComponent[] = [];
  if (s.travel) components.push({ type: "OTHER_EARNING", description: "נסיעות", amount: s.travel });
  if (s.recovery) components.push({ type: "OTHER_EARNING", description: "הבראה", amount: s.recovery });
  if (s.bonus) components.push({ type: "BONUS", amount: s.bonus });
  if (s.otherEarnings > 0) components.push({ type: "OTHER_EARNING", description: "רכיבים נוספים מהתלוש", amount: s.otherEarnings });
  if (s.otherEarnings < 0) components.push({ type: "ABSENCE_DEDUCTION", description: "לפי התלוש", amount: s.otherEarnings });
  if (s.carBenefit) components.push({ type: "OTHER_BENEFIT", description: "שווי רכב (מהתלוש)", amount: s.carBenefit });
  return {
    period: { year: s.year, month: s.month },
    employer: { sector: s.sector },
    employee: { birthDate: s.birthDate || null, gender: s.gender },
    employment: {
      startDate: s.startDate, payType: s.payType, baseSalary: s.payType === "monthly" ? s.baseSalary : undefined,
      hourlyRate: s.payType === "hourly" ? s.hourlyRate : undefined, jobPercent: s.jobPercent || 100, workWeekDays: 5,
      isMainEmployer: true, hasForm101: true,
    },
    taxFacts: { resident: true, creditPointsOverride: s.creditPoints },
    taxSettings: { method: "monthly" },
    pension: s.pensionEnabled ? {
      enabled: true, employeeRate: s.pensionEmployee / 100, employerRate: s.pensionEmployer / 100, severanceRate: s.severance / 100, startDate: s.startDate,
    } : null,
    studyFund: s.studyFundEnabled ? { enabled: true, employeeRate: s.studyFundEmployee / 100, employerRate: s.studyFundEmployer / 100, capAtCeiling: true } : null,
    attendance: { workDays: s.workDays, regularHours: s.payType === "hourly" ? s.hours : undefined, ot125: s.ot125, ot150: s.ot150 },
    components,
  };
}
