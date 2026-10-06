import { requireUser } from "@/server/auth";
import { getEmployer } from "@/server/repo";
import { annualSummary } from "@/server/reports";
import { toCsv } from "@/lib/csv";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
const m = (v: number) => v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  await requireUser();
  const { kind } = await params;
  const u = new URL(req.url);
  const employerId = Number(u.searchParams.get("employer"));
  const year = Number(u.searchParams.get("year"));
  const er = getEmployer(employerId);
  if (!er || !year) return new Response("פרמטרים חסרים", { status: 400 });
  const rows = annualSummary(employerId, year);

  if (kind === "126") {
    const csv = toCsv(
      ["ת.ז", "שם", "חודשי עבודה", "ברוטו", "הכנסה חייבת", "מס הכנסה", "ב\"ל עובד", "מס בריאות", "ב\"ל מעסיק", "פנסיה עובד", "תגמולי מעסיק", "פיצויים", "השתלמות עובד", "השתלמות מעסיק", "שווי רכב", "נקודות זיכוי (ממוצע)"],
      rows.map((a) => [a.idNumber, a.name, a.months.length, a.gross, a.taxable, a.incomeTax, a.niEmployee, a.health, a.niEmployer, a.pensionEmployee, a.pensionEmployer, a.severance, a.studyFundEmployee, a.studyFundEmployer, a.carBenefit, a.creditPointsAvg]),
    );
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="annual-126-${employerId}-${year}.csv"` } });
  }
  if (kind === "106") {
    const a = rows.find((r) => r.employeeId === Number(u.searchParams.get("employee")));
    if (!a) return new Response("אין נתונים לעובד בשנה זו", { status: 404 });
    const row = (k: string, v: string) => `<tr><td>${esc(k)}</td><td class="n">${v}</td></tr>`;
    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>ריכוז שנתי ${year} – ${esc(a.name)}</title>
<style>body{font-family:Arial,"DejaVu Sans",sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:18pt;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}td{border-bottom:1px solid #ddd;padding:6px}td.n{text-align:left;direction:ltr}.note{font-size:9pt;color:#555;margin-top:16px}</style></head><body>
<h1>ריכוז שנתי לעובד (בסיס לטופס 106) – ${year}</h1>
<p><b>מעסיק:</b> ${esc(er.name)} · תיק ניכויים ${esc(er.deductions_file ?? "—")}<br><b>עובד:</b> ${esc(a.name)} · ת.ז ${esc(a.idNumber)} · חודשי עבודה: ${a.months.join(", ")}</p>
<table>
${row("סה\"כ משכורת (ברוטו)", m(a.gross))}${row("הכנסה חייבת במס", m(a.taxable))}${row("מס הכנסה שנוכה", m(a.incomeTax))}
${row("ביטוח לאומי (עובד)", m(a.niEmployee))}${row("מס בריאות", m(a.health))}
${row("הפקדות עובד לקופת גמל לקצבה", m(a.pensionEmployee))}${row("זיכוי ממס בגין הפקדות לפנסיה (45א)", m(a.pensionCredit))}
${row("הפקדות מעסיק לתגמולים", m(a.pensionEmployer))}${row("הפקדות מעסיק לפיצויים", m(a.severance))}
${row("קרן השתלמות – עובד / מעסיק", `${m(a.studyFundEmployee)} / ${m(a.studyFundEmployer)}`)}
${row("שווי רכב", m(a.carBenefit))}${row("סה\"כ שווי הטבות", m(a.benefits))}
${row("זיכוי נקודות (סכום שנתי)", m(a.creditsAmount))}${row("נקודות זיכוי (ממוצע חודשי)", String(a.creditPointsAvg))}
</table>
<p class="note">מסמך זה הוא ריכוז נתונים מתוך תלושי השכר במערכת, בפורמט פנימי. אינו הטופס הרשמי של רשות המסים.</p>
<script>window.onload=()=>window.print()</script></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return new Response("לא נמצא", { status: 404 });
}
