import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import ExcelJS from "exceljs";
import { parseUploadedFile, ImportFileError } from "@/server/import-file";
import { applyMapping, detectHeaderRow, guessMapping } from "@/domain/bank/import";

const csv = "תאריך,תיאור,חובה,זכות,יתרה\n01/03/2026,משכורת,,\"9,660.34\",\"10,660.34\"\n02/03/2026,עמלה,5.90,,\"10,654.44\"\n";

describe("קריאת קבצים מהבנק", () => {
  it("CSV בקידוד windows-1255", async () => {
    const r = await parseUploadedFile("tnuot.csv", iconv.encode(csv, "win1255"));
    expect(r.encoding).toBe("windows-1255");
    expect(r.grid[0][1]).toBe("תיאור");
    const h = detectHeaderRow(r.grid);
    const t = applyMapping(r.grid, h, guessMapping(r.grid[h]));
    expect(t.txns.map((x) => x.amount)).toEqual([9660.34, 5.9]);
  });
  it("CSV ב-UTF-8 עם BOM", async () => {
    const r = await parseUploadedFile("a.csv", Buffer.from("﻿" + csv, "utf8"));
    expect(r.grid[1][1]).toBe("משכורת");
  });
  it("קובץ xls שהוא בפועל טבלת HTML", async () => {
    const html = `<html><body><table><tr><th>תאריך</th><th>תיאור</th><th>סכום</th></tr><tr><td>05/03/2026</td><td>ביט&nbsp;העברה</td><td>-100.00</td></tr></table></body></html>`;
    const r = await parseUploadedFile("export.xls", iconv.encode(html, "win1255"));
    expect(r.fileType).toBe("html");
    expect(r.grid[1]).toEqual(["05/03/2026", "ביט העברה", "-100.00"]);
  });
  it("xlsx עם תאריכים כ-Date", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(["תאריך", "תיאור", "סכום", "יתרה"]);
    ws.addRow([new Date(Date.UTC(2026, 2, 9)), "משכורת", 9660.34, 19660.34]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseUploadedFile("a.xlsx", buf);
    const t = applyMapping(r.grid, 0, guessMapping(r.grid[0]));
    expect(t.txns[0]).toMatchObject({ transactionDate: "2026-03-09", amount: 9660.34, direction: "CREDIT", balanceAfter: 19660.34 });
  });
  it("xls בינארי ישן – הודעה ברורה", async () => {
    await expect(parseUploadedFile("old.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).rejects.toThrow(ImportFileError);
  });
});
