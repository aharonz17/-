import Link from "next/link";
import { listEmployees } from "@/server/repo";
import { PageHead, Money } from "@/components/ui";
import { dateIL } from "@/lib/format";

export default function EmployeesPage() {
  const rows = listEmployees();
  return (
    <>
      <PageHead title="עובדים"><Link className="btn" href="/employees/new">+ עובד חדש</Link></PageHead>
      <div className="card table-wrap">
        {rows.length ? (
          <table>
            <thead><tr><th>שם</th><th>ת.ז</th><th>מעסיק</th><th>תחילת עבודה</th><th>סוג</th><th>היקף</th><th className="num">שכר / תעריף</th><th>סטטוס</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/employees/${e.id}`}>{e.first_name} {e.last_name}</Link></td>
                  <td className="ltr">{e.id_number}</td>
                  <td>{e.employer_name}</td>
                  <td>{dateIL(e.start_date)}</td>
                  <td>{e.pay_type === "hourly" ? "שעתי" : e.pay_type === "daily" ? "יומי" : "חודשי"}</td>
                  <td>{e.job_percent}%</td>
                  <td className="num"><Money v={e.pay_type === "hourly" ? e.hourly_rate : e.base_salary} /></td>
                  <td><span className={`badge ${e.status === "ACTIVE" ? "ok" : ""}`}>{e.status === "ACTIVE" ? "פעיל" : "לא פעיל"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">אין עובדים. <Link href="/employees/new">הוסיפו עובד</Link>.</p>}
      </div>
    </>
  );
}
