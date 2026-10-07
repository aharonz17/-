import Link from "next/link";
import { listRuns } from "@/server/payroll";
import { PageHead, Money, Flash, type SP } from "@/components/ui";
import { RUN_STATUS, periodIL, dateIL } from "@/lib/format";

export default async function RunsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const runs = listRuns();
  return (
    <>
      <PageHead title="הרצות שכר"><Link className="btn" href="/payroll/new">+ הרצה חדשה</Link></PageHead>
      <Flash sp={sp} />
      <div className="card table-wrap">
        {runs.length ? (
          <table>
            <thead><tr><th>#</th><th>תקופה</th><th>מעסיק</th><th>תאריך תשלום</th><th>סטטוס</th><th>עובדים</th><th className="num">ברוטו</th><th className="num">נטו לתשלום</th><th className="num">עלות מעסיק</th></tr></thead>
            <tbody>
              {runs.map((r) => {
                const t = JSON.parse(r.totals_json || "{}");
                return (
                  <tr key={r.id}>
                    <td><Link href={`/payroll/${r.id}`}>{r.id}</Link></td>
                    <td><Link href={`/payroll/${r.id}`}>{periodIL(r.year, r.month)}</Link></td>
                    <td>{r.employer_name}</td>
                    <td>{dateIL(r.payment_date)}</td>
                    <td><span className={`badge ${RUN_STATUS[r.status]?.cls}`}>{RUN_STATUS[r.status]?.label}</span></td>
                    <td>{t.employees ?? ""}</td>
                    <td className="num"><Money v={t.gross} /></td>
                    <td className="num"><Money v={t.netToPay} /></td>
                    <td className="num"><Money v={t.employerCost} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="muted">אין הרצות. <Link href="/payroll/new">צרו הרצה ראשונה</Link>.</p>}
      </div>
    </>
  );
}
