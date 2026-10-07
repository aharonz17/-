/* נתוני הדגמה: מעסיק, שני עובדים, 3 חודשי שכר, חשבונות הדמיה ותנועות. הכל מסומן כהדמיה. */
import { getDb } from "../src/server/db";
import { saveEmployer, saveEmployee, saveEmployment, saveTaxProfile } from "../src/server/repo";
import { approveRun, calculateRun, createRun, listEntries, updateEntryInput, defaultPaymentDate, defaultEntryInput } from "../src/server/payroll";
import { addSimulatedTxn, autoMatch, createAccount, listPayments, postPaymentToSimulatedAccount } from "../src/server/bank";
import { currentEmployment } from "../src/server/repo";

const db = getDb();
if ((db.prepare("SELECT COUNT(*) c FROM employers WHERE name LIKE 'הדגמה%'").get() as { c: number }).c) {
  console.log("נתוני ההדגמה כבר קיימים.");
  process.exit(0);
}

const employerId = saveEmployer({
  name: "הדגמה – חברה לדוגמה בע\"מ", company_id: "515555555", deductions_file: "945555555", ni_file: "945555555",
  address: "רחוב הדוגמה 1", city: "תל אביב", sector: "private", bank_code: "12", branch: "600", account: "123456",
  masav_institution_code: "12345678", masav_sender_code: "12345", start_date: "2020-01-01", status: "ACTIVE",
});

const a = saveEmployee({ employer_id: employerId, employee_number: "101", id_number: "000000018", first_name: "ישראל", last_name: "ישראלי",
  birth_date: "1999-03-10", gender: "male", marital_status: "single", city: "רמת גן", bank_code: "10", branch: "800", account: "1234567", payment_method: "BANK", status: "ACTIVE" });
saveEmployment(a, {
  start_date: "2024-01-01", end_date: null, role: "מפתח", department: "פיתוח", job_percent: 100, pay_type: "monthly", base_salary: 12000,
  hourly_rate: null, daily_rate: null, work_week_days: 5, standard_hours: null, is_main_employer: 1, has_form_101: 1, prior_seniority_months: 0,
  vacation_opening: 4, sick_opening: 10,
  settings: { taxMethod: "monthly", pension: { enabled: true, employeeRate: 0.06, employerRate: 0.065, severanceRate: 0.06, startDate: "2024-01-01", provider: "קרן פנסיה לדוגמה" },
    travel: { dailyFare: 18 }, recovery: { mode: "none" } },
});
saveTaxProfile(a, 2026, { resident: true }, {});

const b = saveEmployee({ employer_id: employerId, employee_number: "102", id_number: "000000026", first_name: "שרה", last_name: "כהן",
  birth_date: "1988-07-21", gender: "female", marital_status: "married", city: "חיפה", bank_code: "20", branch: "450", account: "654321", payment_method: "BANK", status: "ACTIVE" });
saveEmployment(b, {
  start_date: "2019-05-01", end_date: null, role: "מנהלת כספים", department: "כספים", job_percent: 100, pay_type: "monthly", base_salary: 20000,
  hourly_rate: null, daily_rate: null, work_week_days: 5, standard_hours: null, is_main_employer: 1, has_form_101: 1, prior_seniority_months: 0,
  vacation_opening: 12, sick_opening: 40,
  settings: { taxMethod: "monthly", pension: { enabled: true, employeeRate: 0.06, employerRate: 0.065, severanceRate: 0.0833, startDate: "2019-05-01" },
    studyFund: { enabled: true, employeeRate: 0.025, employerRate: 0.075, capAtCeiling: true }, recovery: { mode: "monthly" } },
});
saveTaxProfile(b, 2026, { resident: true, children: [{ birthDate: "2022-02-01" }, { birthDate: "2021-05-01" }] }, {});

const accA = createAccount({ bank_code: "10", branch: "800", account_number: "1234567", holder: "ישראל ישראלי (הדמיה)", owner_type: "employee", owner_id: a, currency: "ILS", opening_balance: 10000, opening_date: "2026-01-01", kind: "SIMULATED" });
const accB = createAccount({ bank_code: "20", branch: "450", account_number: "654321", holder: "שרה כהן (הדמיה)", owner_type: "employee", owner_id: b, currency: "ILS", opening_balance: 25000, opening_date: "2026-01-01", kind: "SIMULATED" });

for (const month of [1, 2, 3]) {
  const runId = createRun(employerId, 2026, month, defaultPaymentDate(2026, month), undefined, "seed");
  for (const e of listEntries(runId)) {
    const emp = currentEmployment(e.employee_id)!;
    const input = defaultEntryInput(emp, 2026, month);
    if (e.employee_id === a && month === 2) { input.attendance.ot125 = 6; input.attendance.ot150 = 2; input.components = [{ type: "BONUS", description: "בונוס רבעוני", amount: 1500 }]; }
    if (e.employee_id === a && month === 3) { input.attendance.sickEpisodes = [{ days: 2 }]; input.attendance.workDays -= 2; }
    if (e.employee_id === b && month === 1) { input.attendance.vacationDays = 3; }
    updateEntryInput(e.id, input, "seed");
  }
  const t = calculateRun(runId, "seed");
  if (t.errors) throw new Error(`שגיאות בחישוב חודש ${month}`);
  approveRun(runId, "seed");
  for (const p of listPayments({ status: "PENDING" }).filter((x) => x.run_id === runId)) postPaymentToSimulatedAccount(p.id, p.employee_id === a ? accA : accB, "seed");
  const m = String(month).padStart(2, "0");
  addSimulatedTxn(accA, "rent", `2026-${m}-01`, 4200, undefined, "seed");
  addSimulatedTxn(accA, "card", `2026-${m}-10`, 2350 + month * 120, undefined, "seed");
  addSimulatedTxn(accA, "fee", `2026-${m}-28`, 12.9, undefined, "seed");
  addSimulatedTxn(accB, "utilities", `2026-${m}-15`, 480, undefined, "seed");
  addSimulatedTxn(accB, "withdrawal", `2026-${m}-20`, 500, undefined, "seed");
}
const matched = autoMatch("seed");
console.log(`נתוני הדגמה נוצרו: מעסיק ${employerId}, עובדים ${a}, ${b}, 3 חודשי שכר, ${matched} התאמות.`);
