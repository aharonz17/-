import crypto from "node:crypto";
import { getDb, json } from "./db";
import { audit } from "./audit";
import { pdfTextItems } from "./pdf-text";
import { listEmployers, saveEmployee, saveEmployer, saveEmployment, saveTaxProfile } from "./repo";
import { extractPayslip, type ExtractedPayslip } from "@/domain/payslip-import/extract";
import type { Scenario } from "@/domain/payslip-import/scenario";

// ייבוא תלוש קיים (PDF) – הכל מקומי. הקובץ נשמר במסד כדי שאפשר יהיה לחזור אליו.

export type PayslipImportRow = {
  id: number; file_name: string; file_hash: string; lines_json: string; extracted_json: string; scenario_json: string | null; employee_id: number | null; created_at: string;
};

export async function importPayslipPdf(fileName: string, buf: Buffer, actor?: string) {
  if (buf.length > 10 * 1024 * 1024) throw new Error("הקובץ גדול מ-10MB.");
  const items = await pdfTextItems(buf);
  const { fields, lines } = extractPayslip(items);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const id = Number(getDb().prepare("INSERT INTO payslip_imports (file_name, file_hash, raw_blob, lines_json, extracted_json) VALUES (?, ?, ?, ?, ?)")
    .run(fileName, hash, buf, JSON.stringify(lines), JSON.stringify(fields)).lastInsertRowid);
  audit({ entityType: "payslip_import", entityId: id, action: "UPLOAD", actor, newValue: { fileName, found: Object.values(fields).filter(Boolean).length } });
  return id;
}

export function getPayslipImport(id: number) {
  const r = getDb().prepare("SELECT id, file_name, file_hash, lines_json, extracted_json, scenario_json, employee_id, created_at FROM payslip_imports WHERE id = ?").get(id) as PayslipImportRow | undefined;
  if (!r) return undefined;
  return { ...r, lines: json<string[]>(r.lines_json, []), fields: json<ExtractedPayslip>(r.extracted_json, {} as ExtractedPayslip), scenario: json<Scenario | null>(r.scenario_json, null) };
}

export const listPayslipImports = () => (getDb().prepare("SELECT id, file_name, extracted_json, employee_id, created_at FROM payslip_imports ORDER BY id DESC LIMIT 50").all() as PayslipImportRow[])
  .map((r) => ({ ...r, fields: json<ExtractedPayslip>(r.extracted_json, {} as ExtractedPayslip) }));

export function deletePayslipImport(id: number, actor?: string) {
  getDb().prepare("DELETE FROM payslip_imports WHERE id = ?").run(id);
  audit({ entityType: "payslip_import", entityId: id, action: "DELETE", actor });
}

export type SaveAsEmployeeInput = {
  importId: number | null;
  scenario: Scenario;
  employerId: number | null;
  employerName: string;
  employerCompanyId: string | null;
  deductionsFile: string | null;
  firstName: string;
  lastName: string;
  idNumber: string;
  bankCode: string | null;
  branch: string | null;
  account: string | null;
  maritalStatus: string | null;
};

/** יצירת עובד (ומעסיק אם צריך) מהתרחיש */
export function saveScenarioAsEmployee(x: SaveAsEmployeeInput, actor?: string) {
  const db = getDb();
  return db.transaction(() => {
    let employerId = x.employerId;
    if (!employerId) {
      const existing = listEmployers().find((e) => (x.deductionsFile && e.deductions_file === x.deductionsFile) || e.name === x.employerName);
      employerId = existing?.id ?? saveEmployer({ name: x.employerName || "מעסיק מתלוש מיובא", company_id: x.employerCompanyId, deductions_file: x.deductionsFile, sector: x.scenario.sector, status: "ACTIVE" });
    }
    const dup = db.prepare("SELECT id FROM employees WHERE employer_id = ? AND id_number = ?").get(employerId, x.idNumber) as { id: number } | undefined;
    if (dup) throw new Error(`עובד עם ת.ז ${x.idNumber} כבר קיים אצל המעסיק (עובד #${dup.id}).`);
    const s = x.scenario;
    const employeeId = saveEmployee({
      employer_id: employerId, first_name: x.firstName, last_name: x.lastName, id_number: x.idNumber, birth_date: s.birthDate || null, gender: s.gender,
      marital_status: x.maritalStatus, status: "ACTIVE", payment_method: "BANK", bank_code: x.bankCode, branch: x.branch, account: x.account,
    });
    const fixed = [];
    if (s.travel) fixed.push({ type: "OTHER_EARNING" as const, description: "נסיעות", amount: s.travel });
    if (s.otherEarnings > 0) fixed.push({ type: "OTHER_EARNING" as const, description: "רכיבים נוספים", amount: s.otherEarnings });
    if (s.carBenefit) fixed.push({ type: "OTHER_BENEFIT" as const, description: "שווי רכב", amount: s.carBenefit });
    saveEmployment(employeeId, {
      start_date: s.startDate, end_date: null, role: null, department: null, job_percent: s.jobPercent || 100, pay_type: s.payType,
      base_salary: s.payType === "monthly" ? s.baseSalary : null, hourly_rate: s.payType === "hourly" ? s.hourlyRate : null, daily_rate: null,
      work_week_days: 5, standard_hours: null, is_main_employer: 1, has_form_101: 1, prior_seniority_months: 0, vacation_opening: 0, sick_opening: 0,
      settings: {
        taxMethod: "monthly",
        pension: s.pensionEnabled ? { enabled: true, employeeRate: s.pensionEmployee / 100, employerRate: s.pensionEmployer / 100, severanceRate: s.severance / 100, startDate: s.startDate } : { enabled: false, employeeRate: 0.06, employerRate: 0.065, severanceRate: 0.06 },
        studyFund: s.studyFundEnabled ? { enabled: true, employeeRate: s.studyFundEmployee / 100, employerRate: s.studyFundEmployer / 100, capAtCeiling: true } : null,
        recovery: { mode: "none" },
        fixedComponents: fixed,
      },
    });
    saveTaxProfile(employeeId, s.year, { resident: true, creditPointsOverride: s.creditPoints }, {});
    if (x.importId) db.prepare("UPDATE payslip_imports SET employee_id = ?, scenario_json = ? WHERE id = ?").run(employeeId, JSON.stringify(s), x.importId);
    audit({ entityType: "employee", entityId: employeeId, action: "CREATE_FROM_PAYSLIP", actor, newValue: { ...x, account: x.account ? "***" : null } });
    return employeeId;
  })();
}
