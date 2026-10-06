import type { TextItem } from "@/domain/payslip-import/layout";

// חילוץ טקסט מ-PDF מקומית (pdfjs-dist, בלי רשת). תלוש סרוק (תמונה) – אין בו טקסט.

export class PdfTextError extends Error {}

export async function pdfTextItems(buf: Buffer, maxPages = 2): Promise<TextItem[]> {
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new PdfTextError("הקובץ אינו PDF. יש להעלות תלוש בפורמט PDF (כמו שמורידים מחילן / מהמערכת של המעסיק).");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true }).promise;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/password/i.test(msg)) throw new PdfTextError("ה-PDF מוגן בסיסמה. פתחו אותו, הדפיסו ל-PDF חדש בלי סיסמה, והעלו שוב.");
    throw new PdfTextError("לא ניתן לקרוא את קובץ ה-PDF.");
  }
  const items: TextItem[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const offset = (p - 1) * 10000; // עמודים נוספים "מתחת" לראשון
    for (const it of tc.items as { str: string; transform: number[]; width: number }[]) {
      if (!("str" in it)) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5] - offset, w: it.width });
    }
  }
  await doc.cleanup?.();
  if (items.filter((i) => i.str.trim()).length < 10)
    throw new PdfTextError("לא נמצא טקסט ב-PDF – כנראה תלוש סרוק (תמונה). יש להעלות PDF מקורי שהופק ממערכת השכר.");
  return items;
}
