import { describe, expect, it } from "vitest";
import { calculatePayroll } from "@/domain/payroll/engine";
import { findOverlaps } from "@/domain/rules/resolve";
import { RULES } from "@/rules-data";
import { baseInput, rulesFor } from "./fixtures";

// דוגמאות מחושבות מ-research/01 §7–8. אם כלל משתנה – הבדיקות האלו חייבות להיכשל עד שהגרסה מאושרת.

describe("Golden – דוגמאות מהמחקר (2026)", () => {
  it("דוגמה 1: גבר רווק, ברוטו 12,000, 2.25 נקודות", () => {
    const r = calculatePayroll(baseInput(), rulesFor(2026, 6));
    expect(r.totals.grossPay).toBe(12000);
    expect(r.tax.beforeCredits).toBe(1516);
    expect(r.tax.creditPoints).toBe(2.25);
    expect(r.tax.creditPointsAmount).toBe(544.5);
    expect(r.tax.pensionCredit).toBe(203.7);
    expect(r.tax.incomeTax).toBe(767.8);
    expect(r.ni.employee).toBe(380.9);
    expect(r.ni.health).toBe(470.96);
    expect(r.pension.employee).toBe(720);
    expect(r.totals.net).toBe(9660.34);
    expect(r.ni.employer).toBe(673.98);
    expect(r.totals.employerCost).toBe(14173.98);
  });

  it("דוגמה 2: אישה עם שני ילדים (4 ו-5), ברוטו 20,000, קרן השתלמות עד התקרה", () => {
    const r = calculatePayroll(baseInput({
      employee: { birthDate: "1990-01-01", gender: "female" },
      employment: { ...baseInput().employment, baseSalary: 20000 },
      taxFacts: { resident: true, children: [{ birthDate: "2022-02-01" }, { birthDate: "2021-05-01" }] },
      studyFund: { enabled: true, employeeRate: 0.025, employerRate: 0.075, capAtCeiling: true },
    }), rulesFor(2026, 6));
    expect(r.tax.creditPoints).toBe(7.75);
    expect(r.tax.beforeCredits).toBe(3226);
    expect(r.tax.incomeTax).toBe(1146.8);
    expect(r.ni.employee).toBe(940.9);
    expect(r.ni.health).toBe(884.56);
    expect(r.studyFund.employee).toBe(392.8);
    expect(r.studyFund.employer).toBe(1178.4);
    expect(r.studyFund.imputed).toBe(0);
    expect(r.totals.net).toBe(15434.94);
    expect(r.totals.employerCost).toBe(24960.38);
  });

  it("וריאציה: קרן השתלמות על מלוא השכר – זקיפה של 321.60 ותוספת מס ~99.70", () => {
    const base = baseInput({
      employee: { birthDate: "1990-01-01", gender: "female" },
      employment: { ...baseInput().employment, baseSalary: 20000 },
      taxFacts: { resident: true, children: [{ birthDate: "2022-02-01" }, { birthDate: "2021-05-01" }] },
    });
    const r = calculatePayroll({ ...base, studyFund: { enabled: true, employeeRate: 0.025, employerRate: 0.075, capAtCeiling: false } }, rulesFor(2026, 6));
    expect(r.studyFund.imputed).toBe(321.6);
    expect(r.bases.tax).toBe(20321.6);
    expect(r.tax.incomeTax).toBe(1246.5); // 1146.80 + 321.60×31%
    expect(r.studyFund.employee).toBe(500);
  });

  it("שכר מינימום: מס 0, ב\"ל ובריאות מופחתים", () => {
    const r = calculatePayroll(baseInput({ employment: { ...baseInput().employment, baseSalary: 6443.85 } }), rulesFor(2026, 6));
    expect(r.tax.incomeTax).toBe(0);
    expect(r.ni.employee + r.ni.health).toBeCloseTo(275.16, 2); // עיגול נפרד לכל ניכוי
    expect(r.pension.employee).toBe(386.63);
    expect(r.totals.net).toBe(5782.06);
    expect(r.messages.find((m) => m.code === "MIN_WAGE")).toBeUndefined();
  });

  // הערה: המחקר ציין חיסכון מרבי של 313.50 – זה החיסכון ב-20,000 ₪. החיסכון המרבי הוא
  // 2,850×11% + 2,660×4% = 419.90 ₪ (משכר 25,100 ומעלה).
  it("ריווח המדרגות 2026: חיסכון 313.50 ב-20,000 ו-419.90 מ-25,100", () => {
    const at = (salary: number, y: number) => calculatePayroll(
      { ...baseInput({ employment: { ...baseInput().employment, baseSalary: salary } }), period: { year: y, month: 6 } }, rulesFor(y, 6)).tax.beforeCredits;
    expect(+(at(20000, 2025) - at(20000, 2026)).toFixed(2)).toBe(313.5);
    const input = baseInput({ employment: { ...baseInput().employment, baseSalary: 30000 } });
    const t25 = calculatePayroll({ ...input, period: { year: 2025, month: 6 } }, rulesFor(2025, 6)).tax.beforeCredits;
    const t26 = calculatePayroll(input, rulesFor(2026, 6)).tax.beforeCredits;
    expect(+(t25 - t26).toFixed(2)).toBe(419.9);
  });

  it("אין חפיפות בין גרסאות כללים", () => {
    expect(findOverlaps(RULES)).toEqual([]);
  });
});
