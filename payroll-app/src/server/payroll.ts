import crypto from "node:crypto";
import { getDb, json } from "./db";
import { audit } from "./audit";
import { rulesAt } from "./rules";
import {
  currentEmployment, effectiveTaxProfile, getEmployee, getEmployer, listEmployees,
  type Employee, type Employer, type Employment, type TaxProfile,
} from "./repo";
import { calculatePayroll, PayrollValidationError } from "@/domain/payroll/engine";
import { daysInMonth, pad2, periodEnd, periodStart } from "@/domain/payroll/dates";
import type { Attendance, ExtraComponent, Message, PayrollInput, PayrollResult, YtdTotals } from "@/domain/payroll/types";

export type RunStatus = "DRAFT" | "CALCULATED" | "APPROVED" | "PAID" | "REVERSED";
export type PayrollRun = {
  id: number; employer_id: number; year: number; month: number; payment_date: string; status: RunStatus;
  calculated_at: string | null; approved_at: string | null; totals_json: string; created_at: string;
};
export type RunTotals = { employees: number; gross: number; net: number; netToPay: number; tax: number; ni: number; health: number; employerCost: number; errors: number };

/** נתוני החודש שמוזנים לכל עובד בהרצה */
export type RunEntryInput = {
  attendance: Attendance;
  components: ExtraComponent[];
  recoveryDays?: number | null; // לתשלום הבראה ידני בחודש זה
  note?: string;
};

export type EmployeePayrollRow = {
  id: number; run_id: number; employee_id: number; input_json: string; result_json: string | null; messages_json: string; status: string; updated_at: string;
};

export type PayslipSnapshot = {
  version: 1;
  employer: Employer;
  employee: Employee;
  employment: Employment;
  taxProfile: TaxProfile | null;
  run: { id: number; year: number; month: number; paymentDate: string };
  input: PayrollInput;
  result: PayrollResult;
  createdAt: string;
};

const db = () => getDb();

/** ימי עבודה בחודש (א'–ה' או א'–ו'), ללא חגים */
export function workDaysInMonth(year: number, month: number, weekDays: 5 | 6) {
  let n = 0;
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay(); // 0=ראשון
    if (wd <= 4 || (weekDays === 6 && wd === 5)) n++;
  }
  return n;
}

/** ברירת מחדל לתאריך תשלום: ה-9 בחודש שאחרי (מוקדם יותר אם יוצא בשישי/שבת) */
export function defaultPaymentDate(year: number, month: number) {
  const y = month === 12 ? year + 1 : year, m = month === 12 ? 1 : month + 1;
  let d = 9;
  while ([5, 6].includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) d--;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export const listRuns = (employerId?: number) =>
  db().prepare(`SELECT r.*, e.name employer_name FROM payroll_runs r JOIN employers e ON e.id = r.employer_id
    ${employerId ? "WHERE r.employer_id = ?" : ""} ORDER BY r.year DESC, r.month DESC, r.id DESC`).all(...(employerId ? [employerId] : [])) as (PayrollRun & { employer_name: string })[];

export const getRun = (id: number) => db().prepare("SELECT * FROM payroll_runs WHERE id = ?").get(id) as PayrollRun | undefined;

export function listEntries(runId: number) {
  return db().prepare(`SELECT ep.*, e.first_name, e.last_name, e.id_number, e.employee_number FROM employee_payrolls ep
    JOIN employees e ON e.id = ep.employee_id WHERE ep.run_id = ? ORDER BY e.last_name, e.first_name`).all(runId) as
    (EmployeePayrollRow & { first_name: string; last_name: string; id_number: string; employee_number: string | null })[];
}
export const getEntry = (id: number) => db().prepare("SELECT * FROM employee_payrolls WHERE id = ?").get(id) as EmployeePayrollRow | undefined;

export function defaultEntryInput(employment: Employment, year: number, month: number): RunEntryInput {
  const wd = workDaysInMonth(year, month, employment.work_week_days);
  return {
    attendance: {
      workDays: wd,
      regularHours: employment.pay_type === "hourly" ? 0 : undefined,
      ot125: 0, ot150: 0, rest150: 0, rest175: 0, rest200: 0, holiday150: 0,
      vacationDays: 0, sickEpisodes: [], unpaidDays: 0, holidayPaidDays: 0,
    },
    components: [],
  };
}

export function createRun(employerId: number, year: number, month: number, paymentDate: string, employeeIds?: number[], actor?: string) {
  const open = db().prepare("SELECT id FROM payroll_runs WHERE employer_id = ? AND year = ? AND month = ? AND status != 'REVERSED'").get(employerId, year, month) as { id: number } | undefined;
  if (open && !employeeIds) throw new Error(`כבר קיימת הרצת שכר לחודש ${pad2(month)}/${year} (מס' ${open.id}).`);
  const start = periodStart(year, month), end = periodEnd(year, month);
  const runId = Number(db().prepare("INSERT INTO payroll_runs (employer_id, year, month, payment_date) VALUES (?, ?, ?, ?)").run(employerId, year, month, paymentDate).lastInsertRowid);
  const ins = db().prepare("INSERT INTO employee_payrolls (run_id, employee_id, input_json) VALUES (?, ?, ?)");
  let count = 0;
  for (const e of listEmployees(employerId)) {
    if (employeeIds && !employeeIds.includes(e.id)) continue;
    if (e.status !== "ACTIVE" && !employeeIds) continue;
    const emp = currentEmployment(e.id, end);
    if (!emp || emp.start_date > end || (emp.end_date && emp.end_date < start)) continue;
    // שכבר קיבל תלוש לחודש הזה בהרצה אחרת פעילה
    const dup = db().prepare(`SELECT 1 FROM payslips WHERE employee_id = ? AND year = ? AND month = ? AND status = 'FINAL'`).get(e.id, year, month);
    if (dup) continue;
    ins.run(runId, e.id, JSON.stringify(defaultEntryInput(emp, year, month)));
    count++;
  }
  audit({ entityType: "payroll_run", entityId: runId, action: "CREATE", actor, newValue: { employerId, year, month, paymentDate, employees: count } });
  return runId;
}

export function updateEntryInput(entryId: number, input: RunEntryInput, actor?: string) {
  const e = getEntry(entryId);
  if (!e) throw new Error("רשומה לא נמצאה");
  const run = getRun(e.run_id)!;
  if (!["DRAFT", "CALCULATED"].includes(run.status)) throw new Error("ההרצה נעולה – לא ניתן לשנות נתונים.");
  db().prepare("UPDATE employee_payrolls SET input_json = ?, status = 'DRAFT', result_json = NULL, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(input), entryId);
  db().prepare("UPDATE payroll_runs SET status = 'DRAFT' WHERE id = ?").run(e.run_id);
  audit({ entityType: "employee_payroll", entityId: entryId, action: "UPDATE_INPUT", actor, oldValue: json(e.input_json, {}), newValue: input });
}

/** מצטבר שנתי מהתלוש הסופי האחרון באותה שנה אצל אותו מעסיק */
export function ytdBefore(employeeId: number, employerId: number, year: number, month: number): YtdTotals | null {
  const r = db().prepare(`SELECT snapshot_json FROM payslips WHERE employee_id = ? AND employer_id = ? AND year = ? AND month < ? AND status = 'FINAL'
    ORDER BY month DESC LIMIT 1`).get(employeeId, employerId, year, month) as { snapshot_json: string } | undefined;
  return r ? json<PayslipSnapshot | null>(r.snapshot_json, null)?.result.ytd ?? null : null;
}

export function openingBalances(employeeId: number, year: number, month: number, employment: Employment) {
  const idx = year * 12 + month;
  const last = (type: string) => db().prepare(`SELECT closing FROM balance_entries WHERE employee_id = ? AND type = ? AND (year * 12 + month) < ?
    ORDER BY year DESC, month DESC, id DESC LIMIT 1`).get(employeeId, type, idx) as { closing: number } | undefined;
  return {
    vacationOpening: last("VACATION")?.closing ?? employment.vacation_opening ?? 0,
    sickOpening: last("SICK")?.closing ?? employment.sick_opening ?? 0,
  };
}

export function buildPayrollInput(run: PayrollRun, employer: Employer, employee: Employee, employment: Employment, tax: TaxProfile | undefined, entry: RunEntryInput): PayrollInput {
  const s = employment.settings;
  const recovery = entry.recoveryDays ? { mode: "manual" as const, days: entry.recoveryDays } : s.recovery?.mode === "monthly" ? s.recovery : null;
  return {
    period: { year: run.year, month: run.month },
    paymentDate: run.payment_date,
    employer: { sector: employer.sector },
    employee: { birthDate: employee.birth_date, gender: employee.gender },
    employment: {
      startDate: employment.start_date, endDate: employment.end_date, payType: employment.pay_type,
      baseSalary: employment.base_salary ?? undefined, hourlyRate: employment.hourly_rate ?? undefined, dailyRate: employment.daily_rate ?? undefined,
      jobPercent: employment.job_percent, workWeekDays: employment.work_week_days, standardMonthlyHours: employment.standard_hours ?? undefined,
      isMainEmployer: !!employment.is_main_employer, hasForm101: !!employment.has_form_101, priorSeniorityMonths: employment.prior_seniority_months,
    },
    taxFacts: tax?.facts ?? { resident: true },
    taxSettings: { method: s.taxMethod ?? "monthly", override: tax?.settings.override ?? null },
    pension: s.pension ?? null,
    studyFund: s.studyFund ?? null,
    car: s.car ?? null,
    phone: s.phone ?? null,
    travel: s.travel ?? null,
    recovery,
    attendance: entry.attendance,
    components: [...(s.fixedComponents ?? []), ...entry.components],
    balances: openingBalances(employee.id, run.year, run.month, employment),
    ytd: ytdBefore(employee.id, employer.id, run.year, run.month),
  };
}

function loadContext(entry: EmployeePayrollRow) {
  const run = getRun(entry.run_id)!;
  const employer = getEmployer(run.employer_id)!;
  const employee = getEmployee(entry.employee_id)!;
  const employment = currentEmployment(employee.id, periodEnd(run.year, run.month));
  const tax = effectiveTaxProfile(employee.id, run.year);
  return { run, employer, employee, employment, tax };
}

export function calculateEntry(entryId: number): { ok: boolean; messages: Message[]; result?: PayrollResult } {
  const entry = getEntry(entryId)!;
  const { run, employer, employee, employment, tax } = loadContext(entry);
  let messages: Message[];
  let result: PayrollResult | undefined;
  try {
    if (!employment) throw new PayrollValidationError([{ level: "ERROR", code: "NO_EMPLOYMENT", text: "לעובד אין פרטי העסקה." }]);
    const input = buildPayrollInput(run, employer, employee, employment, tax, json(entry.input_json, defaultEntryInput(employment, run.year, run.month)));
    if (!tax) {
      input.taxFacts = { resident: true };
    }
    result = calculatePayroll(input, rulesAt(periodStart(run.year, run.month)));
    messages = result.messages;
    if (!tax) messages.unshift({ level: "WARNING", code: "NO_TAX_PROFILE", text: `לא הוזן פרופיל מס לשנת ${run.year} – חושב כתושב/ת ללא נקודות נוספות.` });
    if (employee.payment_method === "BANK" && (!employee.bank_code || !employee.branch || !employee.account))
      messages.push({ level: "WARNING", code: "NO_BANK", text: "חסרים פרטי חשבון בנק לעובד – לא ניתן ליצור תשלום בנקאי." });
  } catch (e) {
    messages = e instanceof PayrollValidationError ? e.messages : [{ level: "ERROR", code: "ENGINE", text: (e as Error).message }];
  }
  const hasError = messages.some((m) => m.level === "ERROR");
  db().prepare("UPDATE employee_payrolls SET result_json = ?, messages_json = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(result && !hasError ? JSON.stringify(result) : null, JSON.stringify(messages), hasError ? "ERROR" : "CALCULATED", entryId);
  return { ok: !hasError, messages, result: hasError ? undefined : result };
}

export function runTotals(runId: number): RunTotals {
  const t: RunTotals = { employees: 0, gross: 0, net: 0, netToPay: 0, tax: 0, ni: 0, health: 0, employerCost: 0, errors: 0 };
  for (const e of listEntries(runId)) {
    t.employees++;
    if (e.status === "ERROR") t.errors++;
    const r = json<PayrollResult | null>(e.result_json, null);
    if (!r) continue;
    t.gross += r.totals.grossPay; t.net += r.totals.net; t.netToPay += r.totals.netToPay; t.tax += r.tax.incomeTax;
    t.ni += r.ni.employee; t.health += r.ni.health; t.employerCost += r.totals.employerCost;
  }
  for (const k of Object.keys(t) as (keyof RunTotals)[]) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

export function calculateRun(runId: number, actor?: string) {
  const run = getRun(runId);
  if (!run) throw new Error("הרצה לא נמצאה");
  if (!["DRAFT", "CALCULATED"].includes(run.status)) throw new Error("ההרצה כבר אושרה.");
  for (const e of listEntries(runId)) calculateEntry(e.id);
  const totals = runTotals(runId);
  db().prepare("UPDATE payroll_runs SET status = ?, calculated_at = datetime('now'), totals_json = ? WHERE id = ?")
    .run(totals.errors ? "DRAFT" : "CALCULATED", JSON.stringify(totals), runId);
  audit({ entityType: "payroll_run", entityId: runId, action: "CALCULATE", actor, newValue: totals });
  return totals;
}

const hashOf = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** אישור ונעילה: יצירת תלושים (Snapshot בלתי משתנה), יתרות, ותשלומים */
export function approveRun(runId: number, actor?: string) {
  const run = getRun(runId);
  if (!run) throw new Error("הרצה לא נמצאה");
  if (run.status !== "CALCULATED") throw new Error("יש לחשב את ההרצה בהצלחה לפני אישור.");
  const entries = listEntries(runId);
  if (!entries.length) throw new Error("אין עובדים בהרצה.");
  if (entries.some((e) => e.status !== "CALCULATED")) throw new Error("יש עובדים שלא חושבו או שיש בהם שגיאות.");

  const tx = db().transaction(() => {
    const employer = getEmployer(run.employer_id)!;
    const batchItems: { payslipId: number; employee: Employee; amount: number }[] = [];
    for (const e of entries) {
      const { employee, employment, tax } = loadContext(e);
      const result = json<PayrollResult>(e.result_json, null as never);
      const input = buildPayrollInput(run, employer, employee, employment!, tax, json(e.input_json, defaultEntryInput(employment!, run.year, run.month)));
      const snapshot: PayslipSnapshot = {
        version: 1, employer, employee, employment: employment!, taxProfile: tax ?? null,
        run: { id: run.id, year: run.year, month: run.month, paymentDate: run.payment_date },
        input, result, createdAt: new Date().toISOString(),
      };
      const sj = JSON.stringify(snapshot);
      const payslipId = Number(db().prepare(`INSERT INTO payslips (employee_payroll_id, run_id, employee_id, employer_id, year, month, snapshot_json, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(e.id, run.id, employee.id, employer.id, run.year, run.month, sj, hashOf(sj)).lastInsertRowid);
      const bal = db().prepare(`INSERT INTO balance_entries (employee_id, type, year, month, opening, accrued, used, closing, payslip_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      bal.run(employee.id, "VACATION", run.year, run.month, result.balances.vacation.opening, result.balances.vacation.accrued, result.balances.vacation.used, result.balances.vacation.closing, payslipId);
      bal.run(employee.id, "SICK", run.year, run.month, result.balances.sick.opening, result.balances.sick.accrued, result.balances.sick.used, result.balances.sick.closing, payslipId);
      if (result.totals.netToPay > 0) batchItems.push({ payslipId, employee, amount: result.totals.netToPay });
    }
    if (batchItems.length) {
      const total = Math.round(batchItems.reduce((a, b) => a + b.amount, 0) * 100) / 100;
      const batchId = Number(db().prepare("INSERT INTO payment_batches (employer_id, run_id, payment_date, total_amount, payment_count) VALUES (?, ?, ?, ?, ?)")
        .run(employer.id, run.id, run.payment_date, total, batchItems.length).lastInsertRowid);
      const ins = db().prepare(`INSERT INTO payments (batch_id, run_id, payslip_id, employee_id, employer_id, beneficiary_name, beneficiary_id, bank_code, branch, account,
        amount, reference, status, payment_date, year, month) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`);
      for (const b of batchItems) {
        ins.run(batchId, run.id, b.payslipId, b.employee.id, employer.id, `${b.employee.first_name} ${b.employee.last_name}`, b.employee.id_number,
          b.employee.bank_code, b.employee.branch, b.employee.account, b.amount, `SAL-${run.year}${pad2(run.month)}-${b.employee.id}`, run.payment_date, run.year, run.month);
      }
    }
    db().prepare("UPDATE payroll_runs SET status = 'APPROVED', approved_at = datetime('now') WHERE id = ?").run(runId);
  });
  tx();
  audit({ entityType: "payroll_run", entityId: runId, action: "APPROVE", actor, newValue: runTotals(runId) });
}

/** ביטול הרצה מאושרת: התלושים נשמרים בסטטוס VOID (לא נמחקים), התשלומים מבוטלים */
export function reverseRun(runId: number, reason: string, actor?: string) {
  const run = getRun(runId);
  if (!run || !["APPROVED", "PAID"].includes(run.status)) throw new Error("ניתן לבטל רק הרצה מאושרת.");
  const matched = db().prepare("SELECT COUNT(*) c FROM transaction_matches m JOIN payments p ON p.id = m.payment_id WHERE p.run_id = ?").get(runId) as { c: number };
  if (matched.c) throw new Error("יש תשלומים שכבר שויכו לתנועות בנק – יש לבטל את השיוך קודם.");
  db().transaction(() => {
    db().prepare("UPDATE payslips SET status = 'VOID' WHERE run_id = ?").run(runId);
    db().prepare("DELETE FROM balance_entries WHERE payslip_id IN (SELECT id FROM payslips WHERE run_id = ?)").run(runId);
    db().prepare("UPDATE payments SET status = 'CANCELLED' WHERE run_id = ?").run(runId);
    db().prepare("UPDATE payroll_runs SET status = 'REVERSED' WHERE id = ?").run(runId);
  })();
  audit({ entityType: "payroll_run", entityId: runId, action: "REVERSE", actor, reason });
}

export function deleteDraftRun(runId: number, actor?: string) {
  const run = getRun(runId);
  if (!run || !["DRAFT", "CALCULATED"].includes(run.status)) throw new Error("ניתן למחוק רק הרצה שלא אושרה.");
  db().prepare("DELETE FROM payroll_runs WHERE id = ?").run(runId);
  audit({ entityType: "payroll_run", entityId: runId, action: "DELETE_DRAFT", actor });
}

// ───── תלושים ─────
export type PayslipRow = { id: number; employee_payroll_id: number; run_id: number; employee_id: number; employer_id: number; year: number; month: number; snapshot_json: string; hash: string; status: string; created_at: string };

export function getPayslip(id: number) {
  const r = db().prepare("SELECT * FROM payslips WHERE id = ?").get(id) as PayslipRow | undefined;
  if (!r) return undefined;
  const snapshot = json<PayslipSnapshot>(r.snapshot_json, null as never);
  return { ...r, snapshot, integrityOk: hashOf(r.snapshot_json) === r.hash };
}

export function listPayslips(filter: { employeeId?: number; employerId?: number; year?: number } = {}) {
  const w: string[] = [], a: unknown[] = [];
  if (filter.employeeId) { w.push("p.employee_id = ?"); a.push(filter.employeeId); }
  if (filter.employerId) { w.push("p.employer_id = ?"); a.push(filter.employerId); }
  if (filter.year) { w.push("p.year = ?"); a.push(filter.year); }
  return (db().prepare(`SELECT p.id, p.year, p.month, p.status, p.run_id, p.employee_id, p.employer_id, p.created_at, p.snapshot_json, e.first_name, e.last_name
    FROM payslips p JOIN employees e ON e.id = p.employee_id ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY p.year DESC, p.month DESC, p.id DESC`).all(...a) as
    (PayslipRow & { first_name: string; last_name: string })[]).map(({ snapshot_json, ...r }) => {
    const s = json<PayslipSnapshot>(snapshot_json, null as never);
    return { ...r, gross: s.result.totals.grossPay, net: s.result.totals.netToPay, employerCost: s.result.totals.employerCost, result: s.result };
  });
}

export function employeeDisplayName(e: { first_name: string; last_name: string }) {
  return `${e.first_name} ${e.last_name}`;
}
