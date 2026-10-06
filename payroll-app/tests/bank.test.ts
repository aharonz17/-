import { describe, expect, it } from "vitest";
import { applyMapping, detectHeaderRow, guessMapping, parseDateCell, parseNumber, type Grid } from "@/domain/bank/import";
import { buildStatement, inferOpeningBalance } from "@/domain/bank/statement";
import { categorize } from "@/domain/bank/categorize";
import { buildIban, validateIban, normalizeBankCode } from "@/domain/bank/banks";
import { buildMasavFile } from "@/domain/bank/masav";
import { matchPayments, scoreMatch } from "@/domain/matching/match";

describe("פענוח ערכים", () => {
  it("מספרים בפורמטים שונים", () => {
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("-1,234.56")).toBe(-1234.56);
    expect(parseNumber("1,234.56-")).toBe(-1234.56);
    expect(parseNumber("(500)")).toBe(-500);
    expect(parseNumber("₪ 12,000.00")).toBe(12000);
    expect(parseNumber("‎-50.5")).toBe(-50.5);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
  it("תאריכים", () => {
    expect(parseDateCell("05/01/2026")).toBe("2026-01-05");
    expect(parseDateCell("5.1.26")).toBe("2026-01-05");
    expect(parseDateCell("2026-01-05")).toBe("2026-01-05");
    expect(parseDateCell(46027)).toBe("2026-01-05"); // מספר סידורי של Excel
    expect(parseDateCell(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01-05");
    expect(parseDateCell("31/02/2026")).toBeNull();
    expect(parseDateCell("01/13/2026")).toBe("2026-01-13"); // אוטומטי: חודש > 12 → MDY
  });
});

describe("אשף ייבוא", () => {
  const grid: Grid = [
    ["בנק לדוגמה – תנועות בחשבון"],
    [],
    ["תאריך", "תאריך ערך", "תיאור", "אסמכתא", "חובה", "זכות", "יתרה בש\"ח"],
    ["01/01/2026", "01/01/2026", "יתרת פתיחה", "", "", "", "10,000.00"],
    ["05/01/2026", "05/01/2026", "העברה", "REF001", "500.00", "", "9,500.00"],
    ["", "", "", "", "", "", ""],
    ["10/01/2026", "10/01/2026", "משכורת חברה בע\"מ", "SALARY01", "", "12,000.00", "21,500.00"],
    ["סה\"כ", "", "", "", "500.00", "12,000.00", ""],
  ];
  it("מזהה שורת כותרת ומיפוי", () => {
    const h = detectHeaderRow(grid);
    expect(h).toBe(2);
    const m = guessMapping(grid[h]);
    expect(m).toMatchObject({ transactionDate: 0, valueDate: 1, description: 2, reference: 3, debit: 4, credit: 5, balanceAfter: 6 });
  });
  it("מייבא, מזהה יתרת פתיחה ומדלג על שורות ריקות וסיכום", () => {
    const h = detectHeaderRow(grid);
    const r = applyMapping(grid, h, guessMapping(grid[h]));
    expect(r.openingBalance).toBe(10000);
    expect(r.txns).toHaveLength(2);
    expect(r.txns[0]).toMatchObject({ direction: "DEBIT", amount: 500, balanceAfter: 9500, reference: "REF001" });
    expect(r.txns[1]).toMatchObject({ direction: "CREDIT", amount: 12000 });
    const st = buildStatement(r.openingBalance!, r.txns);
    expect(st.closingBalance).toBe(21500);
    expect(st.balanced).toBe(true);
  });
  it("עמודת סכום אחת עם סימן וסדר הפוך", () => {
    const g: Grid = [["סכום", "תאריך", "תיאור", "יתרה"], ["-100", "03/02/2026", "עמלה", "900"], ["1000", "01/02/2026", "הפקדה", "1000"]];
    const m = guessMapping(g[0]);
    const r = applyMapping(g, 0, m);
    expect(r.txns.map((t) => t.direction)).toEqual(["CREDIT", "DEBIT"]);
    expect(inferOpeningBalance(r.txns)).toBe(0);
  });
  it("שגיאה כשאין מיפוי סכום", () => {
    const r = applyMapping([["תאריך"], ["01/01/2026"]], 0, { transactionDate: 0 });
    expect(r.issues[0].level).toBe("ERROR");
  });
});

describe("דף חשבון ו-reconciliation", () => {
  it("מזהה פער ביתרה המדווחת עם מספר שורה וגודל ההפרש", () => {
    const st = buildStatement(1000, [
      { transactionDate: "2026-01-01", valueDate: null, amount: 100, direction: "CREDIT", balanceAfter: 1100, description: "a", reference: null },
      { transactionDate: "2026-01-02", valueDate: null, amount: 50, direction: "DEBIT", balanceAfter: 1060, description: "b", reference: null },
    ]);
    expect(st.balanced).toBe(false);
    expect(st.errors[0]).toEqual({ row: 2, expected: 1050, reported: 1060, difference: 10 });
  });
});

describe("סיווג", () => {
  it("מילון תיאורים", () => {
    expect(categorize("משכורת חברה בע\"מ", "CREDIT")).toBe("SALARY");
    expect(categorize("ישראכרט 1234", "DEBIT")).toBe("CARD_SETTLEMENT");
    expect(categorize("עמלת ערוץ ישיר", "DEBIT")).toBe("BANK_FEES");
    expect(categorize("ב.ל. קצבת ילדים", "CREDIT")).toBe("BENEFITS");
    expect(categorize("BIT העברה", "DEBIT")).toBe("P2P");
    expect(categorize("משהו", "DEBIT")).toBe("OTHER");
  });
});

describe("בנקים ו-IBAN", () => {
  it("IBAN נבנה ומאומת", () => {
    const iban = buildIban("10", "800", "12345678");
    expect(iban).toHaveLength(23);
    expect(validateIban(iban)).toBe(true);
    expect(validateIban(iban.slice(0, -1) + "0")).toBe(iban.endsWith("0"));
    expect(normalizeBankCode(4)).toBe("04");
  });
  it("קובץ מס\"ב: רשומות באורך 128 וסכום כולל", () => {
    const f = buildMasavFile({
      institutionCode: "12345678", senderCode: "12345", institutionName: "חברה בעמ", paymentDate: "2026-02-05", createdDate: "2026-02-01",
      payments: [{ bankCode: "10", branch: "800", account: "1234567", idNumber: "123456782", name: "ישראל ישראלי", amount: 9660.34, reference: "P1", periodFrom: { year: 2026, month: 1 }, periodTo: { year: 2026, month: 1 } }],
    });
    const lines = f.content.toString("latin1").split("\r\n").filter(Boolean);
    expect(lines.every((l) => l.length === 128)).toBe(true);
    expect(lines).toHaveLength(4);
    expect(f.total).toBe(9660.34);
  });
});

describe("מנוע התאמות", () => {
  const pay = { id: 1, amount: 9660.34, paymentDate: "2026-02-05", period: { year: 2026, month: 1 }, beneficiaryName: "ישראל ישראלי", employerName: "חברה לדוגמה בע\"מ", reference: "PAY-1" };
  it("התאמה ודאית עם נימוקים", () => {
    const m = scoreMatch(pay, { id: 9, transactionDate: "2026-02-05", valueDate: "2026-02-05", amount: 9660.34, direction: "CREDIT", description: "משכורת חברה לדוגמה", reference: null });
    expect(m.status).toBe("CONFIRMED");
    expect(m.reasons).toContain("סכום זהה");
  });
  it("סכום שונה – אין התאמה", () => {
    expect(scoreMatch(pay, { id: 9, transactionDate: "2026-02-05", valueDate: null, amount: 9000, direction: "CREDIT", description: "משכורת", reference: null }).status).toBe("UNMATCHED");
  });
  it("כל תנועה משויכת לתשלום אחד בלבד", () => {
    const r = matchPayments([pay, { ...pay, id: 2 }], [{ id: 9, transactionDate: "2026-02-05", valueDate: null, amount: 9660.34, direction: "CREDIT", description: "משכורת", reference: null }]);
    expect(r).toHaveLength(1);
  });
});
