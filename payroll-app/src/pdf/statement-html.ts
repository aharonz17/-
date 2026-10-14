import type { Statement, CanonicalTxn } from "@/domain/bank/statement";
import { CATEGORY_LABELS, INTERNAL_CATEGORIES, type Category } from "@/domain/bank/categorize";

// דוח תנועות פנימי. בכוונה ללא שם/לוגו/עיצוב של בנק – זה דוח של המערכת, לא מסמך בנק.

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
const m = (v: number | null | undefined) => (v === null || v === undefined ? "" : v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const d = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "");

export type StatementReportInput = {
  holder: string;
  bankCode: string;
  branch: string | null;
  accountMasked: string;
  simulated: boolean;
  statement: Statement<CanonicalTxn & { category: Category }>;
  generatedAt: string;
  ownerLogo?: string | null; // לוגו מעסיק – אם החשבון שייך למעסיק
};

export function renderStatementHtml(x: StatementReportInput) {
  const st = x.statement;
  const byCat = new Map<Category, { credit: number; debit: number }>();
  for (const r of st.rows) {
    const c = byCat.get(r.category) ?? { credit: 0, debit: 0 };
    if (r.direction === "CREDIT") c.credit += r.amount; else c.debit += r.amount;
    byCat.set(r.category, c);
  }
  const logo = x.ownerLogo && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(x.ownerLogo) ? x.ownerLogo : null;

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח תנועות פנימי – ${esc(x.holder)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, "DejaVu Sans", FreeSans, sans-serif; font-size: 9pt; color: #111; margin: 0; }
  .wm { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 80pt; font-weight: 700; color: rgba(110,60,160,.14); transform: rotate(-25deg); pointer-events: none; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #444; padding-bottom: 3mm; margin-bottom: 3mm; }
  h1 { font-size: 14pt; margin: 0 0 1mm; }
  .notice { background: #f2f2f2; border: 1px solid #bbb; padding: 2mm 3mm; margin-bottom: 3mm; font-size: 8.5pt; }
  .sum { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin-bottom: 3mm; }
  .sum div { border: 1px solid #bbb; padding: 2mm; text-align: center; }
  .sum b { display: block; font-size: 8pt; color: #444; }
  .sum span { font-size: 11pt; font-weight: 700; direction: ltr; unicode-bidi: isolate; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
  th, td { border-bottom: 1px solid #ddd; padding: 1mm 1.5mm; text-align: right; }
  th { background: #eee; font-size: 8pt; }
  td.n { text-align: left; direction: ltr; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.err td { background: #fde7e5; }
  thead { display: table-header-group; }
  .logo { max-height: 15mm; max-width: 40mm; margin-inline-end: 3mm; }
  .foot { font-size: 7.5pt; color: #555; border-top: 1px solid #ccc; padding-top: 2mm; }
</style></head><body>
${x.simulated ? `<div class="wm">הדמיה</div>` : ""}
<div class="head">
  <div style="display:flex;align-items:center">${logo ? `<img class="logo" src="${logo}" alt="">` : ""}
    <div><h1>דוח תנועות – דוח פנימי</h1>
    <div>${esc(x.holder)} · קוד בנק ${esc(x.bankCode)} · סניף ${esc(x.branch ?? "—")} · חשבון ${esc(x.accountMasked)}</div></div>
  </div>
  <div style="text-align:left">תקופה: ${d(st.from)} – ${d(st.to)}<br>הופק: ${d(x.generatedAt)}</div>
</div>
<div class="notice">דוח זה הופק ממערכת השכר והעו״ש הפנימית מתוך נתונים שיובאו או הוזנו בה. <b>אינו מסמך של הבנק ואינו אישור בנקאי.</b>${x.simulated ? " <b>החשבון הוא חשבון הדמיה – הנתונים אינם אמיתיים.</b>" : ""}</div>
<div class="sum">
  <div><b>יתרת פתיחה</b><span>${m(st.openingBalance)}</span></div>
  <div><b>סה״כ זכות</b><span>${m(st.totalCredits)}</span></div>
  <div><b>סה״כ חובה</b><span>${m(st.totalDebits)}</span></div>
  <div><b>יתרת סגירה</b><span>${m(st.closingBalance)}</span></div>
</div>
<table>
  <thead><tr><th>תאריך</th><th>ערך</th><th>תיאור</th><th>אסמכתא</th><th>קטגוריה</th><th>חובה</th><th>זכות</th><th>יתרה</th></tr></thead>
  <tbody>
    <tr><td colspan="7"><b>יתרת פתיחה</b></td><td class="n"><b>${m(st.openingBalance)}</b></td></tr>
    ${st.rows.map((r) => `<tr class="${r.reconciliation.ok ? "" : "err"}"><td>${d(r.transactionDate)}</td><td>${r.valueDate && r.valueDate !== r.transactionDate ? d(r.valueDate) : ""}</td>
      <td>${esc(r.description)}</td><td class="n">${esc(r.reference ?? "")}</td><td>${esc(CATEGORY_LABELS[r.category] ?? "")}</td>
      <td class="n">${r.direction === "DEBIT" ? m(r.amount) : ""}</td><td class="n">${r.direction === "CREDIT" ? m(r.amount) : ""}</td><td class="n">${m(r.runningBalance)}</td></tr>`).join("")}
    <tr><td colspan="5"><b>יתרת סגירה</b></td><td class="n"><b>${m(st.totalDebits)}</b></td><td class="n"><b>${m(st.totalCredits)}</b></td><td class="n"><b>${m(st.closingBalance)}</b></td></tr>
  </tbody>
</table>
<table>
  <thead><tr><th>קטגוריה</th><th>זכות</th><th>חובה</th></tr></thead>
  <tbody>${[...byCat.entries()].map(([c, v]) => `<tr><td>${esc(CATEGORY_LABELS[c])}${INTERNAL_CATEGORIES.includes(c) ? " (העברה פנימית)" : ""}</td><td class="n">${m(v.credit)}</td><td class="n">${m(v.debit)}</td></tr>`).join("")}</tbody>
</table>
<div class="foot">בדיקת התאמה: ${m(st.openingBalance)} + ${m(st.totalCredits)} − ${m(st.totalDebits)} = ${m(st.closingBalance)} · ${st.balanced ? "היתרות תואמות" : `${st.errors.length} שורות שבהן היתרה המדווחת אינה תואמת`}</div>
</body></html>`;
}
