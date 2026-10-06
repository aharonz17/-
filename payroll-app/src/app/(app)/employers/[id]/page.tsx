import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployer, listEmployees } from "@/server/repo";
import { listRuns } from "@/server/payroll";
import { PageHead, Flash, Money, type SP } from "@/components/ui";
import { EmployerForm } from "../EmployerForm";
import { updateEmployerAction } from "../actions";
import { RUN_STATUS, periodIL } from "@/lib/format";

export default async function EmployerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const e = getEmployer(Number(id));
  if (!e) notFound();
  const employees = listEmployees(e.id);
  const runs = listRuns(e.id);
  return (
    <>
      <PageHead title={e.name} sub={`ח.פ ${e.company_id ?? "—"} · תיק ניכויים ${e.deductions_file ?? "—"}`}>
        <Link className="btn" href={`/employees/new?employer=${e.id}`}>+ עובד</Link>
        <Link className="btn secondary" href={`/payroll/new?employer=${e.id}`}>הרצת שכר</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="grid grid-2">
        <div className="card table-wrap">
          <h2>עובדים ({employees.length})</h2>
          <table>
            <thead><tr><th>שם</th><th>ת.ז</th><th>סוג</th><th className="num">שכר</th></tr></thead>
            <tbody>
              {employees.map((w) => (
                <tr key={w.id}>
                  <td><Link href={`/employees/${w.id}`}>{w.first_name} {w.last_name}</Link> {w.status !== "ACTIVE" && <span className="badge">לא פעיל</span>}</td>
                  <td className="ltr">{w.id_number}</td>
                  <td>{w.pay_type === "hourly" ? "שעתי" : w.pay_type === "daily" ? "יומי" : "חודשי"}</td>
                  <td className="num"><Money v={w.pay_type === "hourly" ? w.hourly_rate : w.base_salary} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card table-wrap">
          <h2>הרצות שכר</h2>
          <table>
            <thead><tr><th>תקופה</th><th>סטטוס</th><th className="num">נטו</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/payroll/${r.id}`}>{periodIL(r.year, r.month)}</Link></td>
                  <td><span className={`badge ${RUN_STATUS[r.status]?.cls}`}>{RUN_STATUS[r.status]?.label}</span></td>
                  <td className="num"><Money v={JSON.parse(r.totals_json || "{}").netToPay} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>עריכת פרטי מעסיק</h2>
        <EmployerForm action={updateEmployerAction.bind(null, e.id)} e={e} submit="שמירה" />
      </div>
    </>
  );
}
