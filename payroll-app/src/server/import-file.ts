import ExcelJS from "exceljs";
import Papa from "papaparse";
import iconv from "iconv-lite";
import type { Cell, Grid } from "@/domain/bank/import";

// קריאת קובץ שהמשתמש העלה לגריד אחיד. לא מניחים שום שם עמודה – המיפוי נעשה באשף.
// נתמך: xlsx, csv (UTF-8 או windows-1255), וקבצי "xls" שהם בפועל טבלת HTML (נפוץ בבנקים בישראל).

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ParsedFile = { grid: Grid; fileType: "xlsx" | "csv" | "html"; encoding?: string };

export class ImportFileError extends Error {}

function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8" };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: iconv.decode(buf, "utf16le"), encoding: "utf-16le" };
  const utf8 = buf.toString("utf8");
  // תווי החלפה = לא UTF-8 תקין → כנראה windows-1255
  if (utf8.includes("�")) return { text: iconv.decode(buf, "win1255"), encoding: "windows-1255" };
  return { text: utf8, encoding: "utf-8" };
}

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function parseHtmlTable(html: string): Grid {
  const grid: Grid = [];
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const tr of rows) {
    const cells = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
    grid.push(cells.map((c) => decodeEntities(c.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()));
  }
  return grid;
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("result" in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }
  return String(v);
}

export async function parseUploadedFile(fileName: string, buf: Buffer): Promise<ParsedFile> {
  if (buf.length > MAX_UPLOAD_BYTES) throw new ImportFileError("הקובץ גדול מ-10MB.");
  if (!buf.length) throw new ImportFileError("הקובץ ריק.");
  const lower = fileName.toLowerCase();

  // xlsx = ZIP
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new ImportFileError("לא ניתן לקרוא את קובץ ה-Excel.");
    }
    const ws = wb.worksheets.find((w) => w.rowCount > 0);
    if (!ws) throw new ImportFileError("לא נמצא גיליון עם נתונים.");
    const grid: Grid = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
      grid[n - 1] = vals;
    });
    for (let i = 0; i < grid.length; i++) grid[i] ??= [];
    return { grid, fileType: "xlsx" };
  }
  // xls בינארי ישן (BIFF)
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)
    throw new ImportFileError("קובץ Excel בפורמט ישן (.xls בינארי) אינו נתמך. פתחו אותו ב-Excel ושמרו כ-.xlsx או .csv.");

  const { text, encoding } = decodeText(buf);
  if (/<table/i.test(text.slice(0, 200000))) return { grid: parseHtmlTable(text), fileType: "html", encoding };
  if (lower.endsWith(".pdf") || text.startsWith("%PDF")) throw new ImportFileError("קבצי PDF אינם נתמכים לייבוא. הורידו מהבנק קובץ Excel או CSV.");

  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: false, delimiter: "" });
  if (parsed.errors.length && !parsed.data.length) throw new ImportFileError("לא ניתן לקרוא את קובץ ה-CSV.");
  return { grid: parsed.data as Grid, fileType: "csv", encoding };
}
