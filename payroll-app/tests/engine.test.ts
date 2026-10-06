import { describe, expect, it } from "vitest";
import { calculatePayroll, PayrollValidationError } from "@/domain/payroll/engine";
import { computeCreditPoints } from "@/domain/payroll/credit-points";
import { bracketTax } from "@/domain/payroll/tax";
import { baseInput, rulesFor } from "./fixtures";

const R = rulesFor(2026, 6);
const line = (r: ReturnType<typeof calculatePayroll>, code: string) => r.lines.find((l) => l.code === code);

describe("מדרגות מס", () => {
  it("סכומים מצטברים בנקודות המעבר 2026", () => {
    const b = R.get("income_tax.brackets").payload.monthly;
    expect(bracketTax(7010, b).tax.toNumber()).toBe(701);
    expect(bracketTax(10060, b).tax.toNumber()).toBe(1128);
    expect(bracketTax(19000, b).tax.toNumber()).toBe(2916);
    expect(bracketTax(25100, b).tax.toNumber()).toBe(4807);
    expect(bracketTax(46690, b).tax.toNumber()).toBe(12363.5);
    expect(bracketTax(60130, b).tax.toNumber()).toBe(18680.3);
  });
});

describe("נקודות זיכוי מעובדות", () => {
  const pts = (facts: Parameters<typeof computeCreditPoints>[0], g: "male" | "female" = "male", y = 2026, m = 6) =>
    computeCreditPoints(facts, g, { year: y, month: m }, rulesFor(y, m)).reduce((a, l) => a + l.points, 0);

  it("תושב 2.25, אישה 2.75", () => {
    expect(pts({ resident: true })).toBe(2.25);
    expect(pts({ resident: true }, "female")).toBe(2.75);
  });
  it("חייל משוחרר – 2 נקודות ל-36 חודשים מהחודש שאחרי השחרור", () => {
    const f = { resident: true, dischargedSoldier: { dischargeDate: "2024-03-15", serviceMonths: 32 } };
    expect(pts(f, "male", 2024, 3)).toBe(2.25);
    expect(pts(f, "male", 2024, 4)).toBe(4.25);
    expect(pts(f, "male", 2027, 3)).toBe(4.25);
    expect(pts(f, "male", 2027, 4)).toBe(2.25);
  });
  it("שירות קצר – נקודה אחת", () => {
    expect(pts({ resident: true, dischargedSoldier: { dischargeDate: "2025-01-10", serviceMonths: 14 } })).toBe(3.25);
  });
  it("תואר ראשון – בשנה שאחרי הסיום בלבד", () => {
    expect(pts({ resident: true, degree: { type: "bachelor", completionYear: 2025 } })).toBe(3.25);
    expect(pts({ resident: true, degree: { type: "bachelor", completionYear: 2024 } })).toBe(2.25);
  });
  it("פעוט בן 2 – בסיס + תוספת 2024", () => {
    expect(pts({ resident: true, children: [{ birthDate: "2024-05-01" }] }, "female")).toBe(2.75 + 2.5 + 2);
  });
  it("ילד שנולד אחרי החודש לא נספר", () => {
    expect(pts({ resident: true, children: [{ birthDate: "2026-09-01" }] }, "female")).toBe(2.75);
  });
  it("לוחם מילואים 60 ימים – 1.5 נקודות", () => {
    expect(pts({ resident: true, reserveCombatDaysPrevYear: 60 })).toBe(3.75);
  });
  it("עולה חדש – 3 נקודות בחודשים 13–30", () => {
    expect(pts({ resident: true, newImmigrant: { aliyahDate: "2025-01-15" } })).toBe(5.25);
  });
});

describe("רכיבי שכר", () => {
  it("שעות נוספות לפי ערך שעה = בסיס ÷ 182", () => {
    const r = calculatePayroll(baseInput({ attendance: { workDays: 22, ot125: 2, ot150: 1 } }), R);
    // 12000/182 = 65.934...
    expect(line(r, "020")?.amount).toBe(164.84); // 2 × 65.934 × 1.25
    expect(line(r, "021")?.amount).toBe(98.9);
  });
  it("מחלה לעובד חודשי: יום 1 – 0%, ימים 2-3 – 50%", () => {
    const r = calculatePayroll(baseInput({ attendance: { workDays: 19, sickEpisodes: [{ days: 3 }] } }), R);
    // ערך יום 12000/21.67 = 553.76; לא משולם: 1 + 0.5 + 0.5 = 2 ימים
    expect(line(r, "005")?.amount).toBe(-1107.52);
    expect(r.balances.sick.used).toBe(3);
  });
  it("מחלה בהמשך רצף מחודש קודם – משולם 100%", () => {
    const r = calculatePayroll(baseInput({ attendance: { workDays: 20, sickEpisodes: [{ days: 2, continuesFromDay: 5 }] } }), R);
    expect(line(r, "005")).toBeUndefined();
  });
  it("נסיעות – תקרה יומית 22.60", () => {
    const r = calculatePayroll(baseInput({ travel: { dailyFare: 30 }, attendance: { workDays: 20 } }), R);
    expect(line(r, "030")?.amount).toBe(452);
  });
  it("נסיעות – מוגבל לחופשי חודשי", () => {
    const r = calculatePayroll(baseInput({ travel: { dailyFare: 20, monthlyPass: 250 }, attendance: { workDays: 20 } }), R);
    expect(line(r, "030")?.amount).toBe(250);
  });
  it("שווי רכב חשמלי עם תקרת מחירון", () => {
    const r = calculatePayroll(baseInput({ car: { listPrice: 700000, kind: "electric" } }), R);
    // 596,860 × 2.48% − 1,380
    expect(line(r, "040")?.amount).toBe(13422.13);
    expect(r.bases.tax).toBe(25422.13);
    expect(r.totals.net).toBeLessThan(9660.34);
  });
  it("עובד שעתי", () => {
    const r = calculatePayroll(baseInput({
      employment: { ...baseInput().employment, payType: "hourly", hourlyRate: 50, baseSalary: undefined },
      attendance: { workDays: 20, regularHours: 160, vacationDays: 1 },
    }), R);
    expect(line(r, "002")?.amount).toBe(8000);
    expect(line(r, "010")?.amount).toBe(420); // 8.4 שעות × 50
  });
  it("חודש ראשון חלקי – יחסי", () => {
    const r = calculatePayroll(baseInput({ employment: { ...baseInput().employment, startDate: "2026-06-16" }, pension: null }), R);
    expect(r.totals.grossPay).toBe(6000);
    expect(r.messages.some((m) => m.code === "NO_PENSION")).toBe(true);
  });
  it("הבראה חודשית לפי ותק", () => {
    const r = calculatePayroll(baseInput({ recovery: { mode: "monthly" } }), R);
    // ותק 2.4 שנים → שנה 3 → 6 ימים; 6/12 × 451.5
    expect(line(r, "031")?.amount).toBe(225.75);
  });
  it("ניכויי רשות מורידים רק את הנטו לתשלום", () => {
    const r = calculatePayroll(baseInput({ components: [{ type: "LOAN", amount: 500 }] }), R);
    expect(r.totals.net).toBe(9660.34);
    expect(r.totals.netToPay).toBe(9160.34);
  });
});

describe("מס – מצבים מיוחדים", () => {
  it("בלי טופס 101 – 47% בלי זיכויים", () => {
    const r = calculatePayroll(baseInput({ employment: { ...baseInput().employment, hasForm101: false } }), R);
    expect(r.tax.incomeTax).toBe(5640);
    expect(r.tax.method).toBe("max_rate");
  });
  it("שיטה מצטברת: חודש שני זהה – אותו מס כמו חודשי", () => {
    const first = calculatePayroll(baseInput({ taxSettings: { method: "cumulative" }, period: { year: 2026, month: 1 } }), rulesFor(2026, 1));
    const second = calculatePayroll(baseInput({ taxSettings: { method: "cumulative" }, period: { year: 2026, month: 2 }, ytd: first.ytd }), rulesFor(2026, 2));
    expect(first.tax.incomeTax).toBe(767.8);
    expect(second.tax.incomeTax).toBe(767.8);
  });
  it("שיטה מצטברת: בונוס בחודש אחד מאוזן בחודש הבא", () => {
    const m1 = calculatePayroll(baseInput({ taxSettings: { method: "cumulative" }, period: { year: 2026, month: 1 }, components: [{ type: "BONUS", amount: 10000 }] }), rulesFor(2026, 1));
    const m2 = calculatePayroll(baseInput({ taxSettings: { method: "cumulative" }, period: { year: 2026, month: 2 }, ytd: m1.ytd }), rulesFor(2026, 2));
    const monthly = calculatePayroll(baseInput({ period: { year: 2026, month: 1 }, components: [{ type: "BONUS", amount: 10000 }] }), rulesFor(2026, 1));
    expect(m1.tax.incomeTax).toBe(monthly.tax.incomeTax);
    expect(m2.tax.incomeTax).toBeLessThan(767.8); // החזר חלקי בזכות פריסת המדרגות
  });
  it("ולידציה: חסר שכר בסיס", () => {
    expect(() => calculatePayroll(baseInput({ employment: { ...baseInput().employment, baseSalary: 0 } }), R)).toThrow(PayrollValidationError);
  });
  it("Trace קיים לכל שלב עיקרי", () => {
    const r = calculatePayroll(baseInput(), R);
    const sections = new Set(r.trace.map((t) => t.section));
    for (const s of ["ברוטו", "בסיסים", "מס הכנסה", "ביטוח לאומי", "פנסיה", "נטו", "עלות מעסיק", "יתרות"]) expect(sections.has(s)).toBe(true);
  });
});

import { calculateTermination, noticeDays } from "@/domain/payroll/termination";

describe("גמר חשבון", () => {
  const base = {
    startDate: "2023-01-01", endDate: "2025-12-31", payType: "monthly" as const, lastMonthlySalary: 12000, jobPercent: 100, workWeekDays: 5 as const,
    reason: "dismissal" as const, section14Full: false, severanceFundBalance: 20000, vacationBalanceDays: 5, unpaidRecoveryDays: 0, recoveryDayRate: 451.5, exemptPerYear: 13750,
  };
  it("3 שנים: פיצויים 36,000 והשלמה מעבר לקופה", () => {
    const r = calculateTermination(base);
    expect(r.seniorityMonths).toBe(36);
    expect(r.severanceAmount).toBe(36000);
    expect(r.severanceTopUp).toBe(16000);
    expect(r.noticeDays).toBe(30);
    expect(r.noticePayInLieu).toBe(12000);
  });
  it("סעיף 14 מלא – אין השלמה", () => {
    expect(calculateTermination({ ...base, section14Full: true }).severanceTopUp).toBe(0);
  });
  it("התפטרות רגילה – אין פיצויים", () => {
    expect(calculateTermination({ ...base, reason: "resignation" }).severanceEntitled).toBe(false);
  });
  it("הודעה מוקדמת לפי החוק", () => {
    expect(noticeDays("monthly", 3)).toBe(3);
    expect(noticeDays("monthly", 8)).toBe(11);
    expect(noticeDays("hourly", 18)).toBe(17);
    expect(noticeDays("hourly", 40)).toBe(30);
  });
});
