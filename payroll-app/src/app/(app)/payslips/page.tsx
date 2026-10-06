import Link from "next/link";
import { listPayslips } from "@/server/payroll";
import { listEmployers } from "@/server/repo";
import { PageHead, Money, type SP } from "@/components/ui";
import { periodIL } from "@/lib/format";

export default async function PayslipsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const employerId = Number(sp.employer) || undefined;
  const year = Number(sp.year) || undefined;
  const rows = listPayslips({ employerId, year });
  const employers = listEmployers();
  return (
    <>
      <PageHead title="תלושים" />
      <form className="actions card no-print" method="get">
        <select name="employer" defaultValue={employerId ?? ""} style={{ maxWidth: 240 }}>
          <option value="">כל המעסיקים</option>
          {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input name="year" placeholder="שנה" defaultValue={year ?? ""} style={{ maxWidth: 100 }} inputMode="numeric" />
        <button className="btn secondary" type="submit">סינון</button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>#</th><th>עובד</th><th>תקופה</th><th>סטטוס</th><th className="num">ברוטו</th><th className="num">מס הכנסה</th><th className="num">נטו לתשלום</th><th className="num">עלות מעסיק</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td><Link href={`/payslips/${s.id}`}>{s.first_name} {s.last_name}</Link></td>
                <td>{periodIL(s.year, s.month)}</td>
                <td>{s.status === "FINAL" ? <span className="badge ok">סופי</span> : <span className="badge err">בוטל</span>}</td>
                <td className="num"><Money v={s.gross} /></td>
                <td className="num"><Money v={s.result.tax.incomeTax} /></td>
                <td className="num"><Money v={s.net} strong /></td>
                <td className="num"><Money v={s.employerCost} /></td>
                <td><a href={`/api/payslips/${s.id}/pdf`} target="_blank" rel="noreferrer">PDF</a></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="muted">אין תלושים. תלושים נוצרים באישור הרצת שכר.</p>}
      </div>
    </>
  );
}
