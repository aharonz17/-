import Link from "next/link";
import { listEmployers } from "@/server/repo";
import { getDb } from "@/server/db";
import { PageHead } from "@/components/ui";

export default function EmployersPage() {
  const rows = listEmployers();
  const counts = new Map((getDb().prepare("SELECT employer_id, COUNT(*) c FROM employees WHERE status='ACTIVE' GROUP BY employer_id").all() as { employer_id: number; c: number }[]).map((r) => [r.employer_id, r.c]));
  return (
    <>
      <PageHead title="מעסיקים"><Link className="btn" href="/employers/new">+ מעסיק חדש</Link></PageHead>
      <div className="card table-wrap">
        {rows.length ? (
          <table>
            <thead><tr><th>שם</th><th>ח.פ</th><th>תיק ניכויים</th><th>מגזר</th><th>עובדים פעילים</th><th>סטטוס</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/employers/${e.id}`}>{e.name}</Link></td>
                  <td className="ltr">{e.company_id}</td>
                  <td className="ltr">{e.deductions_file}</td>
                  <td>{e.sector === "public" ? "ציבורי" : "פרטי"}</td>
                  <td>{counts.get(e.id) ?? 0}</td>
                  <td><span className={`badge ${e.status === "ACTIVE" ? "ok" : ""}`}>{e.status === "ACTIVE" ? "פעיל" : "לא פעיל"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">אין מעסיקים. <Link href="/employers/new">צרו את הראשון</Link>.</p>}
      </div>
    </>
  );
}
