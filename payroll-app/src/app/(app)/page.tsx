import Link from "next/link";
import { getDb } from "@/server/db";
import { listRuns, listPayslips } from "@/server/payroll";
import { listAccounts, listPayments } from "@/server/bank";
import { PageHead, Stat, Money } from "@/components/ui";
import { RUN_STATUS, periodIL, dateIL, PAYMENT_STATUS } from "@/lib/format";
import { listRuleRows } from "@/server/rules";

export default function Dashboard() {
  const db = getDb();
  const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  const runs = listRuns().slice(0, 6);
  const slips = listPayslips().slice(0, 6);
  const accounts = listAccounts();
  const pending = listPayments({ status: "PENDING" });
  const unverified = listRuleRows().filter((r) => !r.verified).length;
  const errors = count("SELECT COUNT(*) c FROM employee_payrolls WHERE status = 'ERROR'");
  const recentTxns = db.prepare(`SELECT t.id, t.transaction_date, t.description, t.amount, t.direction, a.holder, a.kind, a.id account_id
    FROM bank_transactions t JOIN bank_accounts a ON a.id = t.account_id ORDER BY t.transaction_date DESC, t.id DESC LIMIT 6`).all() as
    { id: number; transaction_date: string; description: string; amount: number; direction: string; holder: string; kind: string; account_id: number }[];
  const empty = count("SELECT COUNT(*) c FROM employers") === 0;

  return (
    <>
      <PageHead title="לוח בקרה" />
      {empty && (
        <div className="card">
          <h2>מתחילים</h2>
          <ol>
            <li><Link href="/employers/new">יוצרים מעסיק</Link></li>
            <li><Link href="/employees/new">מוסיפים עובד</Link> עם פרטי העסקה, מס ופנסיה</li>
            <li><Link href="/payroll/new">מריצים שכר לחודש</Link>, מזינים נוכחות, מחשבים ומאשרים</li>
            <li>מפיקים תלוש PDF, יוצרים תשלום ומתאימים לתנועת הבנק</li>
          </ol>
          <p className="muted small">רוצים לראות דוגמה מלאה? הריצו <code className="ltr">npm run seed</code> ליצירת נתוני הדגמה.</p>
        </div>
      )}
      <div className="grid grid-4">
        <Stat k="מעסיקים" v={count("SELECT COUNT(*) c FROM employers")} href="/employers" />
        <Stat k="עובדים פעילים" v={count("SELECT COUNT(*) c FROM employees WHERE status = 'ACTIVE'")} href="/employees" />
        <Stat k="תלושים שהופקו" v={count("SELECT COUNT(*) c FROM payslips WHERE status = 'FINAL'")} href="/payslips" />
        <Stat k="תשלומים ממתינים להתאמה" v={pending.length} href="/matching" />
        <Stat k="חשבונות בנק" v={accounts.length} href="/bank" />
        <Stat k="תנועות בנק" v={count("SELECT COUNT(*) c FROM bank_transactions")} href="/bank" />
        <Stat k="התאמות שכר↔בנק" v={count("SELECT COUNT(*) c FROM transaction_matches")} href="/matching" />
        <Stat k="עובדים עם שגיאת חישוב" v={errors} href="/payroll" />
      </div>
      {unverified > 0 && (
        <div className="msg WARNING" style={{ marginTop: "1rem" }}>
          {unverified} כללי חישוב מסומנים כ&quot;לא מאומתים&quot; מול מקור רשמי. <Link href="/rules">לצפייה ואימות</Link>
        </div>
      )}
      <div className="grid grid-2" style={{ marginTop: "1rem" }}>
        <div className="card">
          <h2>הרצות שכר אחרונות</h2>
          {runs.length ? (
            <table>
              <thead><tr><th>תקופה</th><th>מעסיק</th><th>סטטוס</th><th className="num">נטו לתשלום</th></tr></thead>
              <tbody>
                {runs.map((r) => {
                  const t = JSON.parse(r.totals_json || "{}");
                  return (
                    <tr key={r.id}>
                      <td><Link href={`/payroll/${r.id}`}>{periodIL(r.year, r.month)}</Link></td>
                      <td>{r.employer_name}</td>
                      <td><span className={`badge ${RUN_STATUS[r.status]?.cls}`}>{RUN_STATUS[r.status]?.label}</span></td>
                      <td className="num"><Money v={t.netToPay} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="muted">אין הרצות עדיין.</p>}
        </div>
        <div className="card">
          <h2>תלושים אחרונים</h2>
          {slips.length ? (
            <table>
              <thead><tr><th>עובד</th><th>תקופה</th><th className="num">ברוטו</th><th className="num">נטו</th></tr></thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/payslips/${s.id}`}>{s.first_name} {s.last_name}</Link></td>
                    <td>{periodIL(s.year, s.month)} {s.status !== "FINAL" && <span className="badge err">בוטל</span>}</td>
                    <td className="num"><Money v={s.gross} /></td>
                    <td className="num"><Money v={s.net} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">אין תלושים עדיין.</p>}
        </div>
        <div className="card">
          <h2>תשלומים ממתינים</h2>
          {pending.length ? (
            <table>
              <thead><tr><th>מוטב</th><th>תאריך</th><th>סטטוס</th><th className="num">סכום</th></tr></thead>
              <tbody>
                {pending.slice(0, 6).map((p) => (
                  <tr key={p.id}><td>{p.beneficiary_name}</td><td>{dateIL(p.payment_date)}</td>
                    <td><span className={`badge ${PAYMENT_STATUS[p.status]?.cls}`}>{PAYMENT_STATUS[p.status]?.label}</span></td>
                    <td className="num"><Money v={p.amount} /></td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">אין תשלומים ממתינים.</p>}
        </div>
        <div className="card">
          <h2>תנועות בנק אחרונות</h2>
          {recentTxns.length ? (
            <table>
              <thead><tr><th>תאריך</th><th>חשבון</th><th>תיאור</th><th className="num">סכום</th></tr></thead>
              <tbody>
                {recentTxns.map((t) => (
                  <tr key={t.id} className={t.kind === "SIMULATED" ? "row-sim" : ""}>
                    <td>{dateIL(t.transaction_date)}</td>
                    <td><Link href={`/bank/${t.account_id}`}>{t.holder}</Link></td>
                    <td>{t.description}</td>
                    <td className="num" style={{ color: t.direction === "CREDIT" ? "var(--ok)" : undefined }}>{t.direction === "DEBIT" ? "-" : ""}<Money v={t.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">אין תנועות.</p>}
        </div>
      </div>
    </>
  );
}
