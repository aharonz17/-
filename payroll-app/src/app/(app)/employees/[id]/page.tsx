import Link from "next/link";
import { notFound } from "next/navigation";
import { currentEmployment, getEmployee, getEmployer, getTaxProfile, effectiveTaxProfile, listTaxProfiles } from "@/server/repo";
import { listPayslips } from "@/server/payroll";
import { getDb } from "@/server/db";
import { rulesAt } from "@/server/rules";
import { computeCreditPoints } from "@/domain/payroll/credit-points";
import { periodStart } from "@/domain/payroll/dates";
import { bankByCode } from "@/domain/bank/banks";
import { PageHead, Flash, Money, type SP } from "@/components/ui";
import { PersonalFields, EmploymentFields, TaxFields } from "../fields";
import { saveTaxAction, updateEmploymentAction, updatePersonalAction } from "../actions";
import { dateIL, periodIL, maskAccount, n2 } from "@/lib/format";

const TABS = [
  ["overview", "סקירה"], ["personal", "פרטים אישיים"], ["employment", "העסקה ושכר"], ["tax", "מס"], ["payslips", "תלושים"], ["balances", "יתרות"],
] as const;

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const e = getEmployee(Number(id));
  if (!e) notFound();
  const tab = (typeof sp.tab === "string" ? sp.tab : "overview") as (typeof TABS)[number][0];
  const employer = getEmployer(e.employer_id)!;
  const m = currentEmployment(e.id);
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const tax = getTaxProfile(e.id, year);
  const effTax = effectiveTaxProfile(e.id, year);
  const slips = listPayslips({ employeeId: e.id });
  const balances = getDb().prepare("SELECT * FROM balance_entries WHERE employee_id = ? ORDER BY year DESC, month DESC, type").all(e.id) as
    { id: number; type: string; year: number; month: number; opening: number; accrued: number; used: number; closing: number }[];
  const lastBal = (t: string) => balances.find((b) => b.type === t)?.closing ?? (t === "VACATION" ? m?.vacation_opening : m?.sick_opening) ?? 0;

  let creditPreview: { label: string; points: number }[] = [];
  try {
    creditPreview = computeCreditPoints(effTax?.facts ?? { resident: true }, e.gender, { year, month: year === now.getFullYear() ? now.getMonth() + 1 : 1 },
      rulesAt(periodStart(year, year === now.getFullYear() ? now.getMonth() + 1 : 1)));
  } catch { /* אין כללים לשנה */ }

  return (
    <>
      <PageHead title={`${e.first_name} ${e.last_name}`} sub={<>ת.ז <span className="ltr">{e.id_number}</span> · <Link href={`/employers/${employer.id}`}>{employer.name}</Link>{e.status !== "ACTIVE" && " · לא פעיל"}</>}>
        <Link className="btn" href={`/payroll/new?employer=${employer.id}&employee=${e.id}`}>חישוב תלוש</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="actions no-print" style={{ marginBottom: "1rem" }}>
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/employees/${e.id}?tab=${k}`} className={`btn small ${tab === k ? "" : "secondary"}`}>{label}</Link>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-3">
          <div className="card">
            <h3>העסקה</h3>
            {m ? (
              <dl className="kv">
                <dt>תחילת עבודה</dt><dd>{dateIL(m.start_date)}</dd>
                {m.end_date && <><dt>סיום</dt><dd>{dateIL(m.end_date)}</dd></>}
                <dt>סוג</dt><dd>{m.pay_type === "hourly" ? "שעתי" : m.pay_type === "daily" ? "יומי" : "חודשי"} · {m.job_percent}%</dd>
                <dt>שכר</dt><dd><Money v={m.pay_type === "hourly" ? m.hourly_rate : m.pay_type === "daily" ? m.daily_rate : m.base_salary} /> ₪</dd>
                <dt>פנסיה</dt><dd>{m.settings.pension?.enabled ? `${+(m.settings.pension.employeeRate * 100).toFixed(2)}% / ${+(m.settings.pension.employerRate * 100).toFixed(2)}% / ${+(m.settings.pension.severanceRate * 100).toFixed(2)}%` : "לא מוגדרת"}</dd>
                <dt>קרן השתלמות</dt><dd>{m.settings.studyFund?.enabled ? "כן" : "לא"}</dd>
                <dt>טופס 101</dt><dd>{m.has_form_101 ? "נמסר" : <span className="badge warn">לא נמסר</span>}</dd>
              </dl>
            ) : <p className="muted">אין פרטי העסקה.</p>}
          </div>
          <div className="card">
            <h3>נקודות זיכוי ({year})</h3>
            {creditPreview.map((c, i) => <div key={i} className="actions" style={{ justifyContent: "space-between" }}><span>{c.label}</span><span className="num">{c.points}</span></div>)}
            <div className="actions" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 6 }}>
              <strong>סה״כ</strong><strong className="num">{n2(creditPreview.reduce((a, c) => a + c.points, 0))}</strong>
            </div>
            {!effTax && <p className="msg WARNING">אין פרופיל מס – <Link href={`/employees/${e.id}?tab=tax&year=${year}`}>להזנה</Link></p>}
          </div>
          <div className="card">
            <h3>יתרות ותשלום</h3>
            <dl className="kv">
              <dt>יתרת חופשה</dt><dd className="num">{n2(lastBal("VACATION"))} ימים</dd>
              <dt>יתרת מחלה</dt><dd className="num">{n2(lastBal("SICK"))} ימים</dd>
              <dt>בנק</dt><dd>{e.bank_code ? `${bankByCode(e.bank_code)?.name ?? e.bank_code} · סניף ${e.branch ?? "—"} · ${maskAccount(e.account)}` : <span className="badge warn">חסר</span>}</dd>
              <dt>תלושים</dt><dd>{slips.filter((s) => s.status === "FINAL").length}</dd>
            </dl>
          </div>
        </div>
      )}

      {tab === "personal" && (
        <form action={updatePersonalAction.bind(null, e.id)} className="stack card">
          <PersonalFields e={e} />
          <div className="actions"><button className="btn" type="submit">שמירה</button></div>
        </form>
      )}

      {tab === "employment" && (
        <form action={updateEmploymentAction.bind(null, e.id, m?.id ?? null)} className="stack card">
          <p className="muted small">שינויים חלים על חישובים חדשים בלבד. תלושים שכבר הופקו לא משתנים.</p>
          <EmploymentFields m={m} />
          <div className="actions"><button className="btn" type="submit">שמירה</button></div>
        </form>
      )}

      {tab === "tax" && (
        <>
          <div className="actions" style={{ marginBottom: "0.75rem" }}>
            <span className="muted">שנת מס:</span>
            {[...new Set([now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1, ...listTaxProfiles(e.id).map((t) => t.tax_year)])].sort((a, b) => b - a).map((y) => (
              <Link key={y} href={`/employees/${e.id}?tab=tax&year=${y}`} className={`btn small ${y === year ? "" : "secondary"}`}>{y}</Link>
            ))}
          </div>
          {!tax && effTax && <div className="msg INFO">אין פרופיל לשנת {year}; מוצגים הנתונים משנת {effTax.tax_year}. שמירה תיצור פרופיל ל-{year}.</div>}
          <form action={saveTaxAction.bind(null, e.id)} className="stack card">
            <TaxFields t={tax ?? effTax} year={year} />
            <div className="actions"><button className="btn" type="submit">שמירת פרופיל מס {year}</button></div>
          </form>
        </>
      )}

      {tab === "payslips" && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>תקופה</th><th>סטטוס</th><th className="num">ברוטו</th><th className="num">מס הכנסה</th><th className="num">נטו לתשלום</th><th className="num">עלות מעסיק</th><th></th></tr></thead>
            <tbody>
              {slips.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/payslips/${s.id}`}>{periodIL(s.year, s.month)}</Link></td>
                  <td>{s.status === "FINAL" ? <span className="badge ok">סופי</span> : <span className="badge err">בוטל</span>}</td>
                  <td className="num"><Money v={s.gross} /></td>
                  <td className="num"><Money v={s.result.tax.incomeTax} /></td>
                  <td className="num"><Money v={s.net} /></td>
                  <td className="num"><Money v={s.employerCost} /></td>
                  <td><a href={`/api/payslips/${s.id}/pdf`} className="small">PDF</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!slips.length && <p className="muted">אין תלושים.</p>}
        </div>
      )}

      {tab === "balances" && (
        <div className="card table-wrap">
          <p className="muted small">יתרות פתיחה מוגדרות: חופשה {n2(m?.vacation_opening)} · מחלה {n2(m?.sick_opening)} (בלשונית העסקה).</p>
          <table>
            <thead><tr><th>תקופה</th><th>סוג</th><th className="num">פתיחה</th><th className="num">צבירה</th><th className="num">ניצול</th><th className="num">סגירה</th></tr></thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.id}>
                  <td>{periodIL(b.year, b.month)}</td><td>{b.type === "VACATION" ? "חופשה" : b.type === "SICK" ? "מחלה" : b.type}</td>
                  <td className="num">{n2(b.opening)}</td><td className="num">{n2(b.accrued)}</td><td className="num">{n2(b.used)}</td><td className="num"><strong>{n2(b.closing)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!balances.length && <p className="muted">היסטוריית יתרות תיווצר עם אישור התלוש הראשון.</p>}
        </div>
      )}
    </>
  );
}
