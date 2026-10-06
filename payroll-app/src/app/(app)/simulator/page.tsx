import Link from "next/link";
import { listPayslipImports } from "@/server/payslip-import";
import { PageHead, Flash, F, type SP } from "@/components/ui";
import { periodIL } from "@/lib/format";
import { deleteImportAction, uploadPayslipAction } from "./actions";

export default async function SimulatorHome({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const imports = listPayslipImports();
  return (
    <>
      <PageHead title="סימולטור שכר" sub="מעלים תלוש קיים – המערכת קוראת אותו, משחזרת את החישוב, ומאפשרת לבדוק &quot;מה אם&quot;.">
        <Link className="btn secondary" href="/simulator/new">סימולציה ריקה (בלי תלוש)</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="card">
        <form action={uploadPayslipAction} className="stack">
          <F label="תלוש שכר בקובץ PDF"><input type="file" name="file" accept=".pdf,application/pdf" required /></F>
          <p className="muted small">
            הקריאה מתבצעת במחשב שלך בלבד – שום דבר לא נשלח לאינטרנט. נתמכים קובצי PDF שהופקו ממערכת שכר (חילן, מיכפל, מלם וכו׳).
            תלוש סרוק או צילום מהטלפון לא נתמך, כי אין בו טקסט.
          </p>
          <div><button className="btn" type="submit">קריאת התלוש</button></div>
        </form>
      </div>
      {imports.length > 0 && (
        <div className="card table-wrap">
          <h2 style={{ marginTop: 0 }}>תלושים שהועלו</h2>
          <table>
            <thead><tr><th>קובץ</th><th>עובד</th><th>חודש</th><th>הועלה</th><th></th></tr></thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/simulator/${i.id}`}>{i.file_name}</Link></td>
                  <td>{i.fields.employeeName?.value ?? "—"} {i.employee_id && <Link className="badge ok" href={`/employees/${i.employee_id}`}>נשמר כעובד</Link>}</td>
                  <td>{i.fields.period ? periodIL(i.fields.period.value.year, i.fields.period.value.month) : "—"}</td>
                  <td className="small">{i.created_at}</td>
                  <td><form action={deleteImportAction.bind(null, i.id)}><button className="btn secondary small" type="submit">מחיקה</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
