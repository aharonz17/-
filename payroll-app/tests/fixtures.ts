import type { PayrollInput } from "@/domain/payroll/types";
import { resolveRules } from "@/domain/rules/resolve";
import { RULES } from "@/rules-data";
import { periodStart } from "@/domain/payroll/dates";

export const rulesFor = (y: number, m: number) => resolveRules(RULES, periodStart(y, m));

export function baseInput(over: Partial<PayrollInput> = {}): PayrollInput {
  return {
    period: { year: 2026, month: 6 },
    employer: { sector: "private" },
    employee: { birthDate: "1995-03-10", gender: "male" },
    employment: {
      startDate: "2024-01-01", payType: "monthly", baseSalary: 12000, jobPercent: 100, workWeekDays: 5,
      isMainEmployer: true, hasForm101: true,
    },
    taxFacts: { resident: true },
    taxSettings: { method: "monthly" },
    pension: { enabled: true, employeeRate: 0.06, employerRate: 0.065, severanceRate: 0.06, startDate: "2024-01-01" },
    attendance: { workDays: 22 },
    ...over,
  };
}
