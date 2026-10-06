import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pdfTextItems, PdfTextError } from "@/server/pdf-text";
import { extractPayslip } from "@/domain/payslip-import/extract";
import { fixVisualHebrew } from "@/domain/payslip-import/layout";
import { scenarioFromExtracted, scenarioToInput } from "@/domain/payslip-import/scenario";
import { calculatePayroll } from "@/domain/payroll/engine";
import { rulesFor } from "./fixtures";

const load = (f: string) => fs.readFileSync(path.join(__dirname, "fixtures", f));

describe("קריאת תלוש קיים (PDF) ושחזור החישוב", () => {
  for (const [file, expected] of [
    ["payslip-monthly-sick.pdf", { name: "ישראל ישראלי", id: "000000018", base: 12000, points: 2.25, net: 9403.15, month: 3 }],
    ["payslip-studyfund.pdf", { name: "שרה כהן", id: "000000026", base: 20000, points: 7.75, net: 15584.61, month: 1 }],
  ] as const) {
    it(`${file}: זיהוי שדות ושחזור הנטו לאגורה`, async () => {
      const { fields } = extractPayslip(await pdfTextItems(load(file)));
      expect(fields.employeeName?.value).toBe(expected.name);
      expect(fields.idNumber?.value).toBe(expected.id);
      expect(fields.baseSalary?.value).toBe(expected.base);
      expect(fields.creditPoints?.value).toBe(expected.points);
      expect(fields.netToPay?.value).toBe(expected.net);
      expect(fields.period?.value).toEqual({ year: 2026, month: expected.month });
      const { scenario, actual } = scenarioFromExtracted(fields, { year: 2026, month: 1 });
      const r = calculatePayroll(scenarioToInput(scenario), rulesFor(2026, expected.month));
      expect(r.totals.grossPay).toBe(actual.gross);
      expect(r.tax.incomeTax).toBe(actual.incomeTax);
      expect(r.ni.employee).toBe(actual.nationalInsurance);
      expect(r.ni.health).toBe(actual.health);
      expect(r.totals.netToPay).toBe(actual.netToPay);
    });
  }
  it("קובץ שאינו PDF – הודעה ברורה", async () => {
    await expect(pdfTextItems(Buffer.from("hello"))).rejects.toThrow(PdfTextError);
  });
  it("תיקון עברית בסדר ויזואלי", () => {
    expect(fixVisualHebrew("וטורב 100")).toBe("100 ברוטו");
  });
});
