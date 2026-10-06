import { listEmployers, listEmployees, getEmployee } from "@/server/repo";
import { defaultPaymentDate } from "@/server/payroll";
import { PageHead, Flash, F, type SP } from "@/components/ui";
import { MONTHS } from "@/lib/format";
import { createRunAction } from "../actions";
import Link from "next/link";

export default async function NewRun({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const employers = listEmployers();
  const employeeId = Number(sp.employee) || undefined;
  const employee = employeeId ? getEmployee(employeeId) : undefined;
  const employerId = Number(sp.employer) || employee?.employer_id || employers[0]?.id;
  const now = new Date();
  // ברירת מחדל: החודש הקודם
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = Number(sp.year) || prev.getFullYear(), m = Number(sp.month) || prev.getMonth() + 1;
  if (!employers.length) return <><PageHead title="הרצת שכר חדשה" /><div className="card">צריך קודם <Link href="/employers/new">ליצור מעסיק</Link>.</div></>;
  const employees = employerId ? listEmployees(employerId).filter((e) => e.status === "ACTIVE") : [];
  return (
    <>
      <PageHead title={employee ? `חישוב תלוש – ${employee.first_name} ${employee.last_name}` : "הרצת שכר חדשה"} sub="שלב 1: בחירת מעסיק, חודש ותאריך תשלום" />
      <Flash sp={sp} />
      <form action={createRunAction} className="stack card">
        <div className="fields">
          <F label="מעסיק">
            <select name="employer_id" defaultValue={employerId}>
              {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </F>
          <F label="חודש">
            <select name="month" defaultValue={m}>{MONTHS.map((n, i) => <option key={i} value={i + 1}>{String(i + 1).padStart(2, "0")} – {n}</option>)}</select>
          </F>
          <F label="שנת מס"><input name="year" inputMode="numeric" defaultValue={y} /></F>
          <F label="תאריך תשלום"><input type="date" name="payment_date" defaultValue={defaultPaymentDate(y, m)} /></F>
          <F label="עובדים">
            <select name="employee_id" defaultValue={employeeId ?? ""}>
              <option value="">כל העובדים הפעילים</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </select>
          </F>
        </div>
        <p className="muted small">תאריך התשלום ברירת מחדל הוא ה-9 לחודש שאחרי (המועד החוקי האחרון), מוקדם יותר אם יוצא בסוף שבוע.</p>
        <div className="actions"><button className="btn" type="submit">המשך להזנת נתוני החודש</button></div>
      </form>
    </>
  );
}
