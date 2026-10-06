import Link from "next/link";
import { listEmployers, listEmployees, currentEmployment } from "@/server/repo";
import { annualSummary, monthly102, severanceFundBalance } from "@/server/reports";
import { getDb } from "@/server/db";
import { rulesAt } from "@/server/rules";
import { calculateTermination } from "@/domain/payroll/termination";
import { PageHead, Money, F, type SP } from "@/components/ui";
import { MONTHS, n2, ils } from "@/lib/format";

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const employers = listEmployers();
  const employerId = Number(sp.employer) || employers[0]?.id;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;
  if (!employerId) return <><PageHead title="דוחות" /><div className="card">אין מעסיקים.</div></>;
  const annual = annualSummary(employerId, year);
  const m102 = monthly102(employerId, year, month);
  const employees = listEmployees(employerId);

  // גמר חשבון
  const termEmp = Number(sp.term_emp) || 0;
  let term: ReturnType<typeof calculateTermination> | null = null;
  if (termEmp && typeof sp.term_end === "string") {
    const m = currentEmployment(termEmp);
    const lastVac = getDb().prepare("SELECT closing FROM balance_entries WHERE employee_id = ? AND type = 'VACATION' ORDER BY year DESC, month DESC LIMIT 1").get(termEmp) as { closing: number } | undefined;
    if (m) {
      const rules = rulesAt(String(sp.term_end));
      const sector = employers.find((e) => e.id === employerId)?.sector ?? "private";
      term = calculateTermination({
        startDate: m.start_date, endDate: String(sp.term_end), payType: m.pay_type, lastMonthlySalary: Number(sp.term_salary) || m.base_salary || 0,
        hourlyRate: m.hourly_rate ?? undefined, jobPercent: m.job_percent, workWeekDays: m.work_week_days,
        reason: (sp.term_reason as "dismissal") || "dismissal", section14Full: sp.term_s14 === "on",
        severanceFundBalance: Number(sp.term_fund) || severanceFundBalance(termEmp),
        vacationBalanceDays: Number(sp.term_vac) || lastVac?.closing || m.vacation_opening, unpaidRecoveryDays: Number(sp.term_rec) || 0,
        recoveryDayRate: rules.get("recovery_pay").payload.dayRate[sector], exemptPerYear: rules.get("severance").payload.exemptPerYear,
      });
    }
  }
  const tot = (k: keyof (typeof annual)[number]) => annual.reduce((a, r) => a + (r[k] as number), 0);

  return (
    <>
      <PageHead title="דוחות" sub="סיכומים מתוך התלושים הסופיים. קבצים להורדה ולבדיקה – המערכת לא משדרת לרשויות." />
      <form className="actions card no-print" method="get">
        <F label="מעסיק"><select name="employer" defaultValue={employerId}>{employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></F>
        <F label="שנה"><input name="year" defaultValue={year} inputMode="numeric" style={{ maxWidth: 100 }} /></F>
        <F label="חודש (ל-102)"><select name="month" defaultValue={month}>{MONTHS.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}</select></F>
        <button className="btn secondary" type="submit">הצגה</button>
      </form>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>סיכום חודשי לדיווח 102 – {String(month).padStart(2, "0")}/{year}</h2>
        <div className="grid grid-4">
          <div className="stat"><div className="v">{m102.employees}</div><div className="k">עובדים</div></div>
          <div className="stat"><div className="v num">{ils(m102.incomeTax)}</div><div className="k">ניכויי מס הכנסה לתשלום</div></div>
          <div className="stat"><div className="v num">{ils(m102.niTotal)}</div><div className="k">ב״ל + בריאות (עובד + מעסיק)</div></div>
          <div className="stat"><div className="v num">{ils(m102.gross)}</div><div className="k">סה״כ שכר</div></div>
        </div>
        <dl className="kv" style={{ marginTop: "0.75rem" }}>
          <dt>הכנסה חייבת במס</dt><dd><Money v={m102.taxable} /></dd>
          <dt>הכנסה לביטוח לאומי</dt><dd><Money v={m102.niBase} /></dd>
          <dt>ב״ל עובד / בריאות / ב״ל מעסיק</dt><dd><Money v={m102.niEmployee} /> / <Money v={m102.health} /> / <Money v={m102.niEmployer} /></dd>
        </dl>
        <p className="muted small">מועד דיווח ותשלום: עד ה-15 בחודש העוקב.</p>
      </div>

      <div className="card table-wrap">
        <div className="page-head"><h2 style={{ margin: 0 }}>סיכום שנתי {year} (בסיס ל-126 ול-106)</h2>
          <a className="btn secondary small" href={`/api/reports/126?employer=${employerId}&year=${year}`}>הורדת CSV</a></div>
        <table>
          <thead><tr><th>עובד</th><th>חודשים</th><th className="num">ברוטו</th><th className="num">הכנסה חייבת</th><th className="num">מס הכנסה</th><th className="num">ב״ל</th><th className="num">בריאות</th><th className="num">פנסיה עובד</th><th className="num">הפרשות מעסיק</th><th>106</th></tr></thead>
          <tbody>
            {annual.map((a) => (
              <tr key={a.employeeId}>
                <td><Link href={`/employees/${a.employeeId}`}>{a.name}</Link></td><td>{a.months.length}</td>
                <td className="num"><Money v={a.gross} /></td><td className="num"><Money v={a.taxable} /></td><td className="num"><Money v={a.incomeTax} /></td>
                <td className="num"><Money v={a.niEmployee} /></td><td className="num"><Money v={a.health} /></td><td className="num"><Money v={a.pensionEmployee} /></td>
                <td className="num"><Money v={a.pensionEmployer + a.severance + a.studyFundEmployer} /></td>
                <td><a href={`/api/reports/106?employer=${employerId}&year=${year}&employee=${a.employeeId}`} target="_blank" rel="noreferrer">טופס</a></td>
              </tr>
            ))}
          </tbody>
          {annual.length > 0 && <tfoot><tr><td>סה״כ</td><td></td><td className="num"><Money v={tot("gross")} /></td><td className="num"><Money v={tot("taxable")} /></td><td className="num"><Money v={tot("incomeTax")} /></td><td className="num"><Money v={tot("niEmployee")} /></td><td className="num"><Money v={tot("health")} /></td><td className="num"><Money v={tot("pensionEmployee")} /></td><td className="num"><Money v={tot("pensionEmployer") + tot("severance") + tot("studyFundEmployer")} /></td><td></td></tr></tfoot>}
        </table>
        {!annual.length && <p className="muted">אין תלושים סופיים לשנה זו.</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>גמר חשבון</h2>
        <form method="get" className="stack no-print">
          <input type="hidden" name="employer" value={employerId} /><input type="hidden" name="year" value={year} />
          <div className="fields">
            <F label="עובד"><select name="term_emp" defaultValue={termEmp || ""}><option value="">בחרו…</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select></F>
            <F label="תאריך סיום"><input type="date" name="term_end" defaultValue={typeof sp.term_end === "string" ? sp.term_end : ""} required /></F>
            <F label="סיבה"><select name="term_reason" defaultValue={String(sp.term_reason ?? "dismissal")}><option value="dismissal">פיטורים</option><option value="resignation_entitled">התפטרות בדין מפוטר</option><option value="resignation">התפטרות</option></select></F>
            <F label="שכר קובע אחרון (ריק = מהכרטיס)"><input name="term_salary" inputMode="decimal" defaultValue={String(sp.term_salary ?? "")} /></F>
            <F label="צבירת פיצויים בקופה (ריק = מהתלושים)"><input name="term_fund" inputMode="decimal" defaultValue={String(sp.term_fund ?? "")} /></F>
            <F label="יתרת חופשה (ריק = אחרונה)"><input name="term_vac" inputMode="decimal" defaultValue={String(sp.term_vac ?? "")} /></F>
            <F label="ימי הבראה שלא שולמו"><input name="term_rec" inputMode="decimal" defaultValue={String(sp.term_rec ?? "")} /></F>
            <label className="check"><input type="checkbox" name="term_s14" defaultChecked={sp.term_s14 === "on"} /> סעיף 14 מלא (8.33%)</label>
          </div>
          <div><button className="btn secondary" type="submit">חישוב</button></div>
        </form>
        {term && (
          <>
            <p>ותק: {n2(term.seniorityYears)} שנים ({term.seniorityMonths} חודשים) · ערך יום {ils(term.dayValue)} · הודעה מוקדמת: {term.noticeDays} ימים</p>
            <table>
              <tbody>{term.lines.map((l, i) => <tr key={i}><td>{l.label}</td><td className="small muted ltr">{l.formula}</td><td className="num"><Money v={l.amount} /></td></tr>)}</tbody>
            </table>
            {term.notes.map((n, i) => <div key={i} className="msg INFO">{n}</div>)}
          </>
        )}
      </div>
    </>
  );
}
