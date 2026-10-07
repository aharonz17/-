import { getDb, json } from "./db";
import type {
  CarSettings, ExtraComponent, PensionSettings, StudyFundSettings, TaxFacts, TaxSettings,
} from "@/domain/payroll/types";

// שכבת גישה לנתונים – שאילתות בלבד, בלי לוגיקה עסקית.

export type Employer = {
  id: number; name: string; company_id: string | null; deductions_file: string | null; ni_file: string | null;
  address: string | null; city: string | null; phone: string | null; email: string | null; sector: "private" | "public";
  bank_code: string | null; branch: string | null; account: string | null;
  masav_institution_code: string | null; masav_sender_code: string | null; start_date: string | null; status: string; created_at: string;
};

export type Employee = {
  id: number; employer_id: number; employee_number: string | null; id_number: string; first_name: string; last_name: string;
  birth_date: string | null; gender: "male" | "female"; marital_status: string | null; address: string | null; city: string | null;
  zip: string | null; phone: string | null; email: string | null; status: string; bank_code: string | null; branch: string | null;
  account: string | null; account_holder: string | null; iban: string | null; payment_method: string; created_at: string; updated_at: string;
};

export type EmploymentSettings = {
  pension?: PensionSettings | null;
  studyFund?: StudyFundSettings | null;
  car?: CarSettings | null;
  phone?: { monthlyCost: number; employeePaid?: number } | null;
  travel?: { dailyFare: number; monthlyPass?: number | null } | null;
  recovery?: { mode: "none" | "monthly" | "manual"; days?: number } | null;
  taxMethod?: "monthly" | "cumulative";
  /** רכיבים קבועים שחוזרים כל חודש (תוספת קבועה, ניכוי ועד וכו') */
  fixedComponents?: ExtraComponent[];
};

export type Employment = {
  id: number; employee_id: number; start_date: string; end_date: string | null; role: string | null; department: string | null;
  job_percent: number; pay_type: "monthly" | "hourly" | "daily"; base_salary: number | null; hourly_rate: number | null; daily_rate: number | null;
  work_week_days: 5 | 6; standard_hours: number | null; is_main_employer: number; has_form_101: number; prior_seniority_months: number;
  vacation_opening: number; sick_opening: number; settings: EmploymentSettings;
};

export type TaxProfile = { id: number; employee_id: number; tax_year: number; facts: TaxFacts; settings: Omit<TaxSettings, "method"> };

const db = () => getDb();

// ───── מעסיקים ─────
export const listEmployers = () => db().prepare("SELECT * FROM employers ORDER BY name").all() as Employer[];
export const getEmployer = (id: number) => db().prepare("SELECT * FROM employers WHERE id = ?").get(id) as Employer | undefined;

const EMPLOYER_COLS = ["name", "company_id", "deductions_file", "ni_file", "address", "city", "phone", "email", "sector", "bank_code", "branch", "account", "masav_institution_code", "masav_sender_code", "start_date", "status"] as const;
export type EmployerInput = Partial<Pick<Employer, (typeof EMPLOYER_COLS)[number]>> & { name: string };

export function saveEmployer(data: EmployerInput, id?: number) {
  const cols = EMPLOYER_COLS.filter((c) => c in data);
  const vals = cols.map((c) => (data as Record<string, unknown>)[c] ?? null);
  if (id) {
    db().prepare(`UPDATE employers SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...vals, id);
    return id;
  }
  return Number(db().prepare(`INSERT INTO employers (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals).lastInsertRowid);
}

// ───── עובדים ─────
export type EmployeeListRow = Employee & { employer_name: string; base_salary: number | null; hourly_rate: number | null; pay_type: string | null; start_date: string | null; job_percent: number | null };
export function listEmployees(employerId?: number) {
  return db().prepare(`SELECT e.*, r.name employer_name, m.base_salary, m.hourly_rate, m.pay_type, m.start_date, m.job_percent
    FROM employees e JOIN employers r ON r.id = e.employer_id
    LEFT JOIN employments m ON m.id = (SELECT id FROM employments WHERE employee_id = e.id ORDER BY start_date DESC, id DESC LIMIT 1)
    ${employerId ? "WHERE e.employer_id = ?" : ""} ORDER BY e.last_name, e.first_name`).all(...(employerId ? [employerId] : [])) as EmployeeListRow[];
}
export const getEmployee = (id: number) => db().prepare("SELECT * FROM employees WHERE id = ?").get(id) as Employee | undefined;

const EMPLOYEE_COLS = ["employer_id", "employee_number", "id_number", "first_name", "last_name", "birth_date", "gender", "marital_status", "address", "city", "zip", "phone", "email", "status", "bank_code", "branch", "account", "account_holder", "iban", "payment_method"] as const;
export type EmployeeInput = Partial<Pick<Employee, (typeof EMPLOYEE_COLS)[number]>>;

export function saveEmployee(data: EmployeeInput, id?: number) {
  const cols = EMPLOYEE_COLS.filter((c) => c in data);
  const vals = cols.map((c) => (data as Record<string, unknown>)[c] ?? null);
  if (id) {
    db().prepare(`UPDATE employees SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...vals, id);
    return id;
  }
  return Number(db().prepare(`INSERT INTO employees (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals).lastInsertRowid);
}

// ───── העסקה ─────
type EmploymentRow = Omit<Employment, "settings"> & { settings_json: string };
const toEmployment = (r: EmploymentRow | undefined): Employment | undefined =>
  r && { ...r, settings: json<EmploymentSettings>(r.settings_json, {}) };

export function currentEmployment(employeeId: number, atDate?: string): Employment | undefined {
  const rows = db().prepare("SELECT * FROM employments WHERE employee_id = ? ORDER BY start_date DESC, id DESC").all(employeeId) as EmploymentRow[];
  const r = atDate ? rows.find((x) => x.start_date <= atDate && (!x.end_date || x.end_date >= atDate.slice(0, 8) + "01")) ?? rows[0] : rows[0];
  return toEmployment(r);
}

export type EmploymentInput = Omit<Employment, "id" | "employee_id">;
export function saveEmployment(employeeId: number, data: EmploymentInput, id?: number) {
  const { settings, ...rest } = data;
  const cols = Object.keys(rest);
  const vals = cols.map((c) => (rest as Record<string, unknown>)[c] ?? null);
  if (id) {
    db().prepare(`UPDATE employments SET ${cols.map((c) => `${c} = ?`).join(", ")}, settings_json = ?, updated_at = datetime('now') WHERE id = ? AND employee_id = ?`)
      .run(...vals, JSON.stringify(settings), id, employeeId);
    return id;
  }
  return Number(db().prepare(`INSERT INTO employments (employee_id, ${cols.join(", ")}, settings_json) VALUES (?, ${cols.map(() => "?").join(", ")}, ?)`)
    .run(employeeId, ...vals, JSON.stringify(settings)).lastInsertRowid);
}

// ───── פרופיל מס ─────
export function getTaxProfile(employeeId: number, year: number): TaxProfile | undefined {
  const r = db().prepare("SELECT * FROM tax_profiles WHERE employee_id = ? AND tax_year = ?").get(employeeId, year) as
    { id: number; employee_id: number; tax_year: number; facts_json: string; settings_json: string } | undefined;
  return r && { id: r.id, employee_id: r.employee_id, tax_year: r.tax_year, facts: json(r.facts_json, { resident: true }), settings: json(r.settings_json, {}) };
}

/** פרופיל המס לשנה; אם אין – הפרופיל האחרון שקדם לה (העובדות עוברות משנה לשנה) */
export function effectiveTaxProfile(employeeId: number, year: number): TaxProfile | undefined {
  const exact = getTaxProfile(employeeId, year);
  if (exact) return exact;
  const r = db().prepare("SELECT tax_year FROM tax_profiles WHERE employee_id = ? AND tax_year < ? ORDER BY tax_year DESC LIMIT 1").get(employeeId, year) as { tax_year: number } | undefined;
  return r ? getTaxProfile(employeeId, r.tax_year) : undefined;
}

export function listTaxProfiles(employeeId: number) {
  return (db().prepare("SELECT tax_year FROM tax_profiles WHERE employee_id = ? ORDER BY tax_year DESC").all(employeeId) as { tax_year: number }[])
    .map((r) => getTaxProfile(employeeId, r.tax_year)!);
}

export function saveTaxProfile(employeeId: number, year: number, facts: TaxFacts, settings: TaxProfile["settings"]) {
  db().prepare(`INSERT INTO tax_profiles (employee_id, tax_year, facts_json, settings_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(employee_id, tax_year) DO UPDATE SET facts_json = excluded.facts_json, settings_json = excluded.settings_json, updated_at = datetime('now')`)
    .run(employeeId, year, JSON.stringify(facts), JSON.stringify(settings));
}
