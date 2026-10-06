import { getDb, json } from "./db";
import type { PayslipSnapshot } from "./payroll";

// דוחות שנתיים/חודשיים מתוך התלושים הסופיים. קבצים להורדה בלבד – בלי שידור לרשויות.

type Slip = { id: number; employee_id: number; employer_id: number; year: number; month: number; snapshot: PayslipSnapshot };

function finalSlips(filter: { employerId?: number; year?: number; month?: number; employeeId?: number }): Slip[] {
  const w = ["status = 'FINAL'"], a: unknown[] = [];
  if (filter.employerId) { w.push("employer_id = ?"); a.push(filter.employerId); }
  if (filter.year) { w.push("year = ?"); a.push(filter.year); }
  if (filter.month) { w.push("month = ?"); a.push(filter.month); }
  if (filter.employeeId) { w.push("employee_id = ?"); a.push(filter.employeeId); }
  return (getDb().prepare(`SELECT id, employee_id, employer_id, year, month, snapshot_json FROM payslips WHERE ${w.join(" AND ")} ORDER BY month`).all(...a) as
    { id: number; employee_id: number; employer_id: number; year: number; month: number; snapshot_json: string }[])
    .map((r) => ({ ...r, snapshot: json<PayslipSnapshot>(r.snapshot_json, null as never) }));
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export type Annual = {
  employeeId: number; name: string; idNumber: string; months: number[]; gross: number; taxable: number; incomeTax: number;
  niEmployee: number; health: number; pensionEmployee: number; pensionEmployer: number; severance: number; studyFundEmployee: number;
  studyFundEmployer: number; benefits: number; carBenefit: number; creditPointsAvg: number; creditsAmount: number; pensionCredit: number; niEmployer: number;
};

export function annualSummary(employerId: number, year: number): Annual[] {
  const by = new Map<number, Annual & { cpSum: number }>();
  for (const s of finalSlips({ employerId, year })) {
    const r = s.snapshot.result, e = s.snapshot.employee;
    const a = by.get(s.employee_id) ?? {
      employeeId: s.employee_id, name: `${e.first_name} ${e.last_name}`, idNumber: e.id_number, months: [], gross: 0, taxable: 0, incomeTax: 0, niEmployee: 0,
      health: 0, pensionEmployee: 0, pensionEmployer: 0, severance: 0, studyFundEmployee: 0, studyFundEmployer: 0, benefits: 0, carBenefit: 0, creditPointsAvg: 0,
      creditsAmount: 0, pensionCredit: 0, niEmployer: 0, cpSum: 0,
    };
    a.months.push(s.month);
    a.gross += r.totals.grossPay; a.taxable += r.bases.tax; a.incomeTax += r.tax.incomeTax; a.niEmployee += r.ni.employee; a.health += r.ni.health;
    a.niEmployer += r.ni.employer; a.pensionEmployee += r.pension.employee; a.pensionEmployer += r.pension.employer + r.pension.disability; a.severance += r.pension.severance;
    a.studyFundEmployee += r.studyFund.employee; a.studyFundEmployer += r.studyFund.employer; a.benefits += r.totals.benefits;
    a.carBenefit += r.lines.filter((l) => l.code === "040").reduce((x, l) => x + l.amount, 0);
    a.creditsAmount += r.tax.creditPointsAmount; a.pensionCredit += r.tax.pensionCredit; a.cpSum += r.tax.creditPoints;
    by.set(s.employee_id, a);
  }
  return [...by.values()].map(({ cpSum, ...a }) => {
    const out = { ...a, creditPointsAvg: a.months.length ? r2(cpSum / a.months.length) : 0 };
    for (const k of Object.keys(out) as (keyof typeof out)[]) if (typeof out[k] === "number") (out as Record<string, unknown>)[k] = r2(out[k] as number);
    return out;
  });
}

export function monthly102(employerId: number, year: number, month: number) {
  const slips = finalSlips({ employerId, year, month });
  const t = { employees: slips.length, gross: 0, taxable: 0, incomeTax: 0, niEmployee: 0, health: 0, niEmployer: 0, niBase: 0 };
  for (const s of slips) {
    const r = s.snapshot.result;
    t.gross += r.totals.grossPay; t.taxable += r.bases.tax; t.incomeTax += r.tax.incomeTax;
    t.niEmployee += r.ni.employee; t.health += r.ni.health; t.niEmployer += r.ni.employer; t.niBase += r.ni.base;
  }
  for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = r2(t[k]);
  return { ...t, niTotal: r2(t.niEmployee + t.health + t.niEmployer), slips };
}

export function severanceFundBalance(employeeId: number) {
  return r2(finalSlips({ employeeId }).reduce((a, s) => a + s.snapshot.result.pension.severance, 0));
}
