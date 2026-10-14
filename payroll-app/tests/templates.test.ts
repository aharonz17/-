import { describe, expect, it } from "vitest";
import { renderPayslipHtml } from "@/pdf/payslip-html";
import { renderStatementHtml } from "@/pdf/statement-html";
import { imageMime } from "@/server/templates";
import { buildStatement } from "@/domain/bank/statement";
import { calculatePayroll } from "@/domain/payroll/engine";
import type { PayslipSnapshot } from "@/server/payroll";
import { baseInput, rulesFor } from "./fixtures";

function snapshot(): PayslipSnapshot {
  const input = baseInput();
  const result = calculatePayroll(input, rulesFor(2026, 6));
  return {
    version: 1,
    employer: { id: 1, name: "חברה <b>בדיקה</b>", company_id: "515555555", deductions_file: "945555555", ni_file: null, address: null, city: null, phone: null, email: null, sector: "private", bank_code: null, branch: null, account: null, masav_institution_code: null, masav_sender_code: null, start_date: null, status: "ACTIVE", created_at: "" },
    employee: { id: 1, employer_id: 1, employee_number: "1", id_number: "000000018", first_name: "ישראל", last_name: "ישראלי", birth_date: null, gender: "male", marital_status: null, address: null, city: null, zip: null, phone: null, email: null, status: "ACTIVE", bank_code: "10", branch: "800", account: "123", account_holder: null, iban: null, payment_method: "BANK", created_at: "", updated_at: "" },
    employment: { id: 1, employee_id: 1, start_date: "2024-01-01", end_date: null, role: null, department: null, job_percent: 100, pay_type: "monthly", base_salary: 12000, hourly_rate: null, daily_rate: null, work_week_days: 5, standard_hours: null, is_main_employer: 1, has_form_101: 1, prior_seniority_months: 0, vacation_opening: 0, sick_opening: 0, settings: {} },
    taxProfile: null,
    run: { id: 1, year: 2026, month: 6, paymentDate: "2026-07-09" },
    input, result, createdAt: "2026-07-01T00:00:00Z",
  };
}
const meta = { payslipId: 1, hash: "abcdef0123456789abcdef", status: "FINAL" };
const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("תבניות תלוש", () => {
  it("שלוש פריסות", () => {
    for (const layout of ["classic", "stacked", "compact"] as const)
      expect(renderPayslipHtml(snapshot(), meta, { template: { layout } })).toContain(`layout-${layout}`);
  });
  it("פריסה לא חוקית חוזרת לקלאסית", () => {
    expect(renderPayslipHtml(snapshot(), meta, { template: { layout: "x\"><script>" as never } })).toContain("layout-classic");
  });
  it("החלפת קוד ושם של רכיב", () => {
    const html = renderPayslipHtml(snapshot(), meta, { template: { codes: { "001": { code: "1", name: "שכר יסוד" } } } });
    expect(html).toContain("שכר יסוד");
    expect(html).not.toContain("משכורת בסיס");
  });
  it("צבע לא חוקי נדחה", () => {
    const html = renderPayslipHtml(snapshot(), meta, { template: { color: "red;}</style><script>" } });
    expect(html).toContain("--c: #1f3b6b");
    expect(html).not.toContain("<script>");
  });
  it("לוגו: רק data URI של PNG/JPEG", () => {
    expect(renderPayslipHtml(snapshot(), meta, { logoDataUri: PNG })).toContain(`src="${PNG}"`);
    expect(renderPayslipHtml(snapshot(), meta, { logoDataUri: "javascript:alert(1)" })).not.toContain("javascript:");
  });
  it("טקסטים מוזנים עוברים escape", () => {
    const html = renderPayslipHtml(snapshot(), meta, { template: { headerText: "<img src=x onerror=alert(1)>" } });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>בדיקה</b>");
  });
  it("סימון 'מערכת שכר פנימית' קבוע", () => {
    expect(renderPayslipHtml(snapshot(), meta)).toContain("הופק במערכת שכר פנימית של המעסיק");
  });
  it("זיהוי סוג תמונה לפי חתימה", () => {
    expect(imageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(imageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageMime(Buffer.from("<svg></svg>"))).toBeNull();
  });
});

describe("דוח עו\"ש פנימי", () => {
  const st = buildStatement(1000, [
    { transactionDate: "2026-06-09", valueDate: null, amount: 9660.34, direction: "CREDIT" as const, balanceAfter: null, description: "משכורת", reference: null, category: "SALARY" as const },
  ]);
  const base = { holder: "ישראל", bankCode: "20", branch: "450", accountMasked: "•••4321", statement: st, generatedAt: "2026-07-01" };
  it("מסומן כדוח פנימי, בלי שם בנק", () => {
    const html = renderStatementHtml({ ...base, simulated: false });
    expect(html).toContain("דוח פנימי");
    expect(html).toContain("אינו מסמך של הבנק");
    expect(html).not.toMatch(/מזרחי|טפחות|לאומי|הפועלים|דיסקונט|מרכנתיל/);
    expect(html).not.toContain("class=\"wm\"");
  });
  it("חשבון הדמיה – סימן מים", () => {
    expect(renderStatementHtml({ ...base, simulated: true })).toContain("class=\"wm\">הדמיה");
  });
});
