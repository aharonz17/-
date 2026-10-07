import type { PayrollResult, PayslipLine } from "@/domain/payroll/types";
import { ils, n2, pctFmt } from "@/lib/format";
import { Money, Stat } from "./ui";

const CAT: [PayslipLine["category"], string][] = [
  ["earning", "תשלומים"], ["benefit", "שווי (זקיפות – לא משולם)"], ["reimbursement", "החזרי הוצאות"],
  ["mandatory", "ניכויי חובה"], ["provident", "ניכויים לקופות"], ["voluntary", "ניכויי רשות"], ["employer", "הפרשות מעסיק"],
];

export function ResultSummary({ r }: { r: PayrollResult }) {
  return (
    <div className="grid grid-4">
      <Stat k="ברוטו" v={ils(r.totals.grossPay)} />
      <Stat k="מס הכנסה" v={ils(r.tax.incomeTax)} />
      <Stat k="ביטוח לאומי + בריאות" v={ils(r.ni.employee + r.ni.health)} />
      <Stat k="פנסיה + השתלמות (עובד)" v={ils(r.pension.employee + r.studyFund.employee)} />
      <Stat k="ניכויי רשות" v={ils(r.totals.voluntaryDeductions)} />
      <Stat k="נטו" v={ils(r.totals.net)} />
      <Stat k="נטו לתשלום" v={<span style={{ color: "var(--ok)" }}>{ils(r.totals.netToPay)}</span>} />
      <Stat k="עלות מעסיק" v={ils(r.totals.employerCost)} />
    </div>
  );
}

export function ResultLines({ r }: { r: PayrollResult }) {
  return (
    <div className="grid grid-2">
      {CAT.map(([cat, title]) => {
        const lines = r.lines.filter((l) => l.category === cat);
        if (!lines.length) return null;
        return (
          <div key={cat} className="card table-wrap">
            <h3>{title}</h3>
            <table>
              <thead><tr><th>קוד</th><th>רכיב</th><th className="num">כמות</th><th className="num">תעריף</th><th className="num">סכום</th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}><td className="ltr">{l.code}</td><td>{l.name}</td><td className="num">{l.quantity !== undefined ? n2(l.quantity) : ""}</td>
                    <td className="num">{l.rate !== undefined ? n2(l.rate) : ""}</td><td className="num"><Money v={l.amount} /></td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>סה״כ</td><td className="num"><Money v={lines.reduce((a, l) => a + l.amount, 0)} /></td></tr></tfoot>
            </table>
          </div>
        );
      })}
      <div className="card">
        <h3>נתוני מס ובסיסים</h3>
        <dl className="kv">
          <dt>הכנסה חייבת במס</dt><dd><Money v={r.bases.tax} /></dd>
          <dt>הכנסה לביטוח לאומי</dt><dd><Money v={r.ni.base} /></dd>
          <dt>שכר לפנסיה</dt><dd><Money v={r.bases.pension} /></dd>
          <dt>מס לפני זיכויים</dt><dd><Money v={r.tax.beforeCredits} /></dd>
          <dt>נקודות זיכוי</dt><dd>{n2(r.tax.creditPoints)} = <Money v={r.tax.creditPointsAmount} /></dd>
          <dt>זיכוי פנסיה (45א)</dt><dd><Money v={r.tax.pensionCredit} /></dd>
          {r.tax.settlementCredit > 0 && <><dt>זיכוי יישוב</dt><dd><Money v={r.tax.settlementCredit} /></dd></>}
          <dt>מס שולי</dt><dd>{pctFmt(r.tax.marginalRate)}</dd>
          <dt>שיטה</dt><dd>{{ monthly: "חודשית", cumulative: "מצטברת", override: "שיעור לפי תיאום", max_rate: "מס מרבי" }[r.tax.method]}</dd>
          <dt>ערך שעה / יום</dt><dd><Money v={r.info.hourValue} /> / <Money v={r.info.dayValue} /></dd>
          <dt>ותק</dt><dd>{n2(r.info.seniorityYears)} שנים</dd>
        </dl>
      </div>
      <div className="card">
        <h3>יתרות ומצטבר שנתי</h3>
        <table>
          <thead><tr><th></th><th className="num">פתיחה</th><th className="num">צבירה</th><th className="num">ניצול</th><th className="num">סגירה</th></tr></thead>
          <tbody>
            <tr><td>חופשה</td><td className="num">{n2(r.balances.vacation.opening)}</td><td className="num">{n2(r.balances.vacation.accrued)}</td><td className="num">{n2(r.balances.vacation.used)}</td><td className="num">{n2(r.balances.vacation.closing)}</td></tr>
            <tr><td>מחלה</td><td className="num">{n2(r.balances.sick.opening)}</td><td className="num">{n2(r.balances.sick.accrued)}</td><td className="num">{n2(r.balances.sick.used)}</td><td className="num">{n2(r.balances.sick.closing)}</td></tr>
          </tbody>
        </table>
        <dl className="kv" style={{ marginTop: "0.75rem" }}>
          <dt>ברוטו מתחילת השנה</dt><dd><Money v={r.ytd.gross} /></dd>
          <dt>הכנסה חייבת מצטברת</dt><dd><Money v={r.ytd.taxableIncome} /></dd>
          <dt>מס הכנסה מצטבר</dt><dd><Money v={r.ytd.incomeTax} /></dd>
          <dt>ב״ל + בריאות מצטבר</dt><dd><Money v={r.ytd.niEmployee + r.ytd.health} /></dd>
        </dl>
      </div>
    </div>
  );
}

export function TraceView({ r }: { r: PayrollResult }) {
  const sections = [...new Set(r.trace.map((t) => t.section))];
  return (
    <div className="card">
      <h2>כיצד חושב?</h2>
      <p className="muted small">כל שורה מציגה את הנוסחה ואת הכלל (וגרסתו) שהפעיל אותה.</p>
      {sections.map((s) => (
        <div key={s} className="trace-section">
          <h3>{s}</h3>
          {r.trace.filter((t) => t.section === s).map((t, i) => (
            <div key={i} className="trace-row">
              <div>{t.label}{t.ruleIds?.length ? <div className="small muted ltr">{t.ruleIds.join(", ")}</div> : null}</div>
              <div className="formula">{t.formula}</div>
              <div className="num"><strong>{ils(t.amount)}</strong></div>
            </div>
          ))}
        </div>
      ))}
      {r.tax.creditPointsBreakdown.length > 0 && (
        <>
          <h3>פירוט נקודות זיכוי</h3>
          {r.tax.creditPointsBreakdown.map((c, i) => (
            <div key={i} className="trace-row"><div>{c.label}</div><div className="formula">{c.ruleId ?? "ידני"}</div><div className="num">{c.points}</div></div>
          ))}
        </>
      )}
      <h3>כללים שהופעלו</h3>
      <table>
        <thead><tr><th>כלל</th><th>גרסה</th><th>מקור</th><th>מאומת</th></tr></thead>
        <tbody>
          {r.rulesUsed.map((u) => (
            <tr key={u.id}><td className="ltr">{u.key}</td><td>{u.version}</td><td className="small">{u.source}</td>
              <td>{u.verified ? <span className="badge ok">כן</span> : <span className="badge warn">לא מאומת</span>}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
