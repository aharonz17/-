import type { PayslipSnapshot } from "@/server/payroll";
import type { PayslipLine } from "@/domain/payroll/types";
import { bankByCode } from "@/domain/bank/banks";

// תבנית תלוש שכר (HTML → PDF). בנויה לפי שדות החובה בסעיף 24 לחוק הגנת השכר והתוספת לו,
// ולפי פריסת "התלוש הקנוני" במחקר (research/02 §6).

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
const m = (v: number | null | undefined) => (v === null || v === undefined ? "" : v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const n = (v: number | null | undefined) => (v === null || v === undefined ? "" : v.toLocaleString("he-IL", { maximumFractionDigits: 2 }));
const d = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "");
export type PayslipTemplate = {
  layout: "classic" | "stacked" | "compact";
  color: string;
  headerText?: string;
  footerText?: string;
  showYtd: boolean;
  /** התאמת קודים ושמות רכיבים: מפתח = הקוד במערכת (למשל "001") */
  codes: Record<string, { code?: string; name?: string }>;
};

export const DEFAULT_TEMPLATE: PayslipTemplate = { layout: "classic", color: "var(--c)", showYtd: true, codes: {} };

const safeColor = (c: string | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : DEFAULT_TEMPLATE.color);

const MARITAL: Record<string, string> = { single: "רווק/ה", married: "נשוי/אה", divorced: "גרוש/ה", widowed: "אלמן/ה", separated: "פרוד/ה" };

function linesTable(title: string, lines: PayslipLine[], opts: { qty?: boolean } = {}) {
  if (!lines.length) return "";
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return `<table class="t"><thead><tr><th colspan="${opts.qty ? 5 : 3}" class="sec">${esc(title)}</th></tr>
    <tr><th>סמל</th><th>תיאור</th>${opts.qty ? "<th>כמות</th><th>תעריף</th>" : ""}<th>סכום</th></tr></thead><tbody>
    ${lines.map((l) => `<tr><td class="c">${esc(l.code)}</td><td>${esc(l.name)}</td>${opts.qty ? `<td class="n">${l.quantity !== undefined ? n(l.quantity) : ""}</td><td class="n">${l.rate !== undefined ? m(l.rate) : ""}</td>` : ""}<td class="n">${m(l.amount)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="${opts.qty ? 4 : 2}">סה״כ</td><td class="n">${m(total)}</td></tr></tfoot></table>`;
}

export function renderPayslipHtml(
  s: PayslipSnapshot,
  meta: { payslipId: number; hash: string; status: string },
  opts: { template?: Partial<PayslipTemplate>; logoDataUri?: string | null } = {},
) {
  const tpl: PayslipTemplate = { ...DEFAULT_TEMPLATE, ...(opts.template ?? {}), codes: opts.template?.codes ?? {} };
  const color = safeColor(tpl.color);
  const r = s.result, e = s.employee, er = s.employer, em = s.employment, a = s.input.attendance;
  const relabel = (l: PayslipLine): PayslipLine => {
    const o = tpl.codes[l.code];
    return o ? { ...l, code: o.code || l.code, name: o.name || l.name } : l;
  };
  const by = (c: PayslipLine["category"]) => r.lines.filter((l) => l.category === c).map(relabel);
  const logo = opts.logoDataUri && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(opts.logoDataUri) ? opts.logoDataUri : null;
  const bank = bankByCode(e.bank_code);
  const sickDays = (a.sickEpisodes ?? []).reduce((x, y) => x + y.days, 0);
  const ot = (a.ot125 ?? 0) + (a.ot150 ?? 0) + (a.rest150 ?? 0) + (a.rest175 ?? 0) + (a.rest200 ?? 0) + (a.holiday150 ?? 0);
  const payTypeLabel = em.pay_type === "hourly" ? "שעתי" : em.pay_type === "daily" ? "יומי" : "חודשי";
  const voidMark = meta.status !== "FINAL" ? `<div class="void">בוטל</div>` : "";

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>תלוש שכר ${String(s.run.month).padStart(2, "0")}/${s.run.year} – ${esc(e.first_name)} ${esc(e.last_name)}</title>
<style>
  :root { --c: ${color}; }
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "DejaVu Sans", FreeSans, sans-serif; font-size: 9.5pt; color: #111; margin: 0; background: #fff; }
  .page { max-width: 190mm; margin: 0 auto; padding: 4mm; position: relative; }
  .void { position: absolute; top: 90mm; left: 0; right: 0; text-align: center; font-size: 72pt; color: rgba(200,0,0,.18); transform: rotate(-20deg); font-weight: 700; pointer-events: none; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--c); padding-bottom: 3mm; margin-bottom: 3mm; }
  .head h1 { font-size: 15pt; margin: 0; color: var(--c); }
  .head .title { text-align: left; }
  .head .title .big { font-size: 14pt; font-weight: 700; }
  .box { border: 1px solid #b9c3d3; border-radius: 2mm; padding: 2mm 3mm; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-bottom: 3mm; }
  .kv { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 0.6mm 3mm; }
  .kv b { font-weight: 600; color: #333; }
  .kv span { font-variant-numeric: tabular-nums; }
  table.t { width: 100%; border-collapse: collapse; margin-bottom: 2.5mm; }
  table.t th, table.t td { border-bottom: 1px solid #dde3ec; padding: 0.8mm 1.5mm; text-align: right; }
  table.t th { background: #eef2f8; font-size: 8.5pt; color: #333; }
  table.t th.sec { background: var(--c); color: #fff; font-size: 9.5pt; text-align: right; }
  table.t tfoot td { font-weight: 700; background: #f5f7fa; }
  td.n { text-align: left; direction: ltr; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.c { color: #555; width: 10mm; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
  .sum { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin: 3mm 0; }
  .sum div { border: 1px solid #b9c3d3; border-radius: 2mm; padding: 2mm; text-align: center; }
  .sum div b { display: block; font-size: 8.5pt; color: #444; font-weight: 600; }
  .sum div span { font-size: 12pt; font-weight: 700; direction: ltr; unicode-bidi: isolate; }
  .sum .net { background: #e8f3ec; border-color: #7fb894; }
  .foot { margin-top: 3mm; font-size: 7.5pt; color: #555; border-top: 1px solid #ccc; padding-top: 2mm; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .notes { font-size: 8pt; color: #333; }
  .logo { max-height: 18mm; max-width: 45mm; margin-inline-end: 4mm; }
  .head .who { display: flex; align-items: center; }
  .headtext { font-size: 8.5pt; color: #333; margin-bottom: 2mm; white-space: pre-line; }
  .layout-stacked .grid2 { grid-template-columns: 1fr; }
  .layout-compact { font-size: 8pt; }
  .layout-compact .grid2 { grid-template-columns: 1fr; gap: 1mm; }
  .layout-compact table.t th, .layout-compact table.t td { padding: 0.4mm 1mm; }
  .layout-compact .sum div span { font-size: 10pt; }
  .layout-compact .kv { grid-template-columns: max-content 1fr max-content 1fr max-content 1fr; }
  @media print { .noprint { display: none; } }
</style></head><body class="layout-${tpl.layout}"><div class="page">${voidMark}
<div class="head">
  <div class="who">
    ${logo ? `<img class="logo" src="${logo}" alt="">` : ""}
    <div>
    <h1>${esc(er.name)}</h1>
    <div>ח.פ/ע.מ: <span class="ltr">${esc(er.company_id ?? "—")}</span> · תיק ניכויים: <span class="ltr">${esc(er.deductions_file ?? "—")}</span>${er.ni_file ? ` · תיק ב״ל: <span class="ltr">${esc(er.ni_file)}</span>` : ""}</div>
    <div>${esc([er.address, er.city].filter(Boolean).join(", "))}${er.phone ? ` · ${esc(er.phone)}` : ""}</div>
    </div>
  </div>
  <div class="title">
    <div class="big">תלוש שכר לחודש ${String(s.run.month).padStart(2, "0")}/${s.run.year}</div>
    <div>תאריך תשלום: ${d(s.run.paymentDate)}</div>
    <div>מס׳ תלוש: ${meta.payslipId} · הופק: ${d(s.createdAt)}</div>
  </div>
</div>

${tpl.headerText ? `<div class="headtext">${esc(tpl.headerText)}</div>` : ""}
<div class="box" style="margin-bottom:3mm">
  <div class="kv">
    <b>שם העובד:</b><span>${esc(e.first_name)} ${esc(e.last_name)}</span>
    <b>מספר זהות:</b><span class="ltr">${esc(e.id_number)}</span>
    <b>מספר עובד:</b><span>${esc(e.employee_number ?? e.id)}</span>
    <b>מחלקה / תפקיד:</b><span>${esc([em.department, em.role].filter(Boolean).join(" / ") || "—")}</span>
    <b>תחילת עבודה:</b><span>${d(em.start_date)}</span>
    <b>ותק:</b><span>${n(r.info.seniorityYears)} שנים</span>
    <b>היקף משרה:</b><span>${n(em.job_percent)}%</span>
    <b>בסיס שכר:</b><span>${payTypeLabel} · ${m(em.pay_type === "hourly" ? em.hourly_rate : em.pay_type === "daily" ? em.daily_rate : em.base_salary)} ₪</span>
    <b>ערך שעה:</b><span>${m(r.info.hourValue)} ₪</span>
    <b>מצב משפחתי:</b><span>${esc(MARITAL[e.marital_status ?? ""] ?? "—")}</span>
    <b>נקודות זיכוי:</b><span>${n(r.tax.creditPoints)}</span>
    <b>כתובת:</b><span>${esc([e.address, e.city].filter(Boolean).join(", ") || "—")}</span>
  </div>
</div>

<div class="grid2">
  <div>
    ${linesTable("תשלומים", by("earning"), { qty: true })}
    ${linesTable("שווי (זקיפות לצורכי מס – אינם משולמים)", by("benefit"))}
    ${linesTable("החזרי הוצאות", by("reimbursement"))}
  </div>
  <div>
    ${linesTable("ניכויי חובה", by("mandatory"))}
    ${linesTable("ניכויים לקופות גמל", by("provident"))}
    ${linesTable("ניכויי רשות", by("voluntary"))}
    ${linesTable("הפרשות מעסיק", by("employer"))}
  </div>
</div>

<div class="sum">
  <div><b>סה״כ תשלומים (ברוטו)</b><span>${m(r.totals.grossPay)}</span></div>
  <div><b>סה״כ ניכויים</b><span>${m(r.totals.totalDeductions)}</span></div>
  <div><b>נטו</b><span>${m(r.totals.net)}</span></div>
  <div class="net"><b>נטו לתשלום</b><span>${m(r.totals.netToPay)}</span></div>
</div>

<div class="grid2">
  <table class="t"><thead><tr><th colspan="4" class="sec">נתוני מס ושכר לזכויות</th></tr></thead><tbody>
    <tr><td>שכר חייב במס</td><td class="n">${m(r.bases.tax)}</td><td>מס שולי</td><td class="n">${n(r.tax.marginalRate * 100)}%</td></tr>
    <tr><td>שכר לביטוח לאומי</td><td class="n">${m(r.ni.base)}</td><td>זיכוי נק׳ (${n(r.tax.creditPoints)})</td><td class="n">${m(r.tax.creditPointsAmount)}</td></tr>
    <tr><td>שכר לזכויות פנסיוניות</td><td class="n">${m(r.bases.pension)}</td><td>זיכוי פנסיה (45א)</td><td class="n">${m(r.tax.pensionCredit)}</td></tr>
    ${r.studyFund.active ? `<tr><td>שכר לקרן השתלמות</td><td class="n">${m(r.studyFund.base)}</td><td>זקיפת השתלמות</td><td class="n">${m(r.studyFund.imputed)}</td></tr>` : ""}
    ${r.tax.settlementCredit ? `<tr><td colspan="2">זיכוי יישוב מזכה</td><td colspan="2" class="n">${m(r.tax.settlementCredit)}</td></tr>` : ""}
    <tr><td>עלות מעסיק</td><td class="n">${m(r.totals.employerCost)}</td><td>שיטת מס</td><td>${{ monthly: "חודשית", cumulative: "מצטברת", override: "תיאום", max_rate: "מרבי" }[r.tax.method]}</td></tr>
  </tbody></table>
  <table class="t"><thead><tr><th colspan="4" class="sec">נוכחות</th></tr></thead><tbody>
    <tr><td>ימי עבודה</td><td class="n">${n(a.workDays)}</td><td>שעות רגילות</td><td class="n">${em.pay_type === "hourly" ? n(a.regularHours ?? 0) : n(+(a.workDays * 42 / em.work_week_days * em.job_percent / 100).toFixed(2))}</td></tr>
    <tr><td>שעות נוספות</td><td class="n">${n(ot)}</td><td>ימי חופשה</td><td class="n">${n(a.vacationDays ?? 0)}</td></tr>
    <tr><td>ימי מחלה</td><td class="n">${n(sickDays)}</td><td>היעדרות ללא תשלום</td><td class="n">${n(a.unpaidDays ?? 0)}</td></tr>
  </tbody></table>
</div>

<div class="grid2">
  <table class="t"><thead><tr><th class="sec">יתרות</th><th>יתרה קודמת</th><th>צבירה</th><th>ניצול</th><th>יתרה</th></tr></thead><tbody>
    <tr><td>חופשה (ימים)</td><td class="n">${n(r.balances.vacation.opening)}</td><td class="n">${n(r.balances.vacation.accrued)}</td><td class="n">${n(r.balances.vacation.used)}</td><td class="n"><b>${n(r.balances.vacation.closing)}</b></td></tr>
    <tr><td>מחלה (ימים)</td><td class="n">${n(r.balances.sick.opening)}</td><td class="n">${n(r.balances.sick.accrued)}</td><td class="n">${n(r.balances.sick.used)}</td><td class="n"><b>${n(r.balances.sick.closing)}</b></td></tr>
    ${r.info.recoveryEntitlementDays ? `<tr><td>הבראה – זכאות שנתית</td><td colspan="4" class="n">${n(r.info.recoveryEntitlementDays)} ימים</td></tr>` : ""}
  </tbody></table>
  ${tpl.showYtd ? `<table class="t"><thead><tr><th colspan="4" class="sec">מצטבר מתחילת השנה (${r.ytd.months} חודשים)</th></tr></thead><tbody>
    <tr><td>ברוטו</td><td class="n">${m(r.ytd.gross)}</td><td>שכר חייב</td><td class="n">${m(r.ytd.taxableIncome)}</td></tr>
    <tr><td>מס הכנסה</td><td class="n">${m(r.ytd.incomeTax)}</td><td>ב״ל + בריאות</td><td class="n">${m(r.ytd.niEmployee + r.ytd.health)}</td></tr>
    <tr><td>פנסיה עובד</td><td class="n">${m(r.ytd.pensionEmployee)}</td><td>זיכויים</td><td class="n">${m(r.ytd.creditsAmount)}</td></tr>
  </tbody></table>` : "<div></div>"}
</div>

<div class="box notes">
  <b>אופן התשלום:</b> ${e.payment_method === "BANK" ? `העברה לחשבון ${esc(bank?.name ?? e.bank_code ?? "—")} · סניף ${esc(e.branch ?? "—")} · חשבון <span class="ltr">${esc(e.account ?? "—")}</span>` : e.payment_method === "CHECK" ? "שיק" : "מזומן"}
  · <b>שכר מינימום:</b> ${m(r.info.minWageMonthly)} ₪ לחודש / ${m(r.info.minWageHourly)} ₪ לשעה
  ${s.input.pension?.provider ? ` · <b>קופת פנסיה:</b> ${esc(s.input.pension.provider)}` : ""}
</div>

${tpl.footerText ? `<div class="headtext" style="margin-top:2mm">${esc(tpl.footerText)}</div>` : ""}
<div class="foot">
  תלוש זה הופק במערכת שכר פנימית של המעסיק ונשמר כ-Snapshot שאינו משתנה. מזהה אימות: <span class="ltr">${meta.hash.slice(0, 16)}</span>.
  גרסאות כללים: <span class="ltr">${esc(r.rulesUsed.map((u) => u.id).join(", "))}</span>.
</div>
</div></body></html>`;
}
