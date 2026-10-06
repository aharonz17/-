import Link from "next/link";
import { notFound } from "next/navigation";
import { getRun, listEntries, runTotals } from "@/server/payroll";
import { getEmployer } from "@/server/repo";
import { getDb, json } from "@/server/db";
import { PageHead, Flash, Money, Stat, type SP } from "@/components/ui";
import { RUN_STATUS, periodIL, dateIL, ils } from "@/lib/format";
import type { Message, PayrollResult } from "@/domain/payroll/types";
import { approveRunAction, calculateRunAction, deleteRunAction, reverseRunAction } from "../actions";

export default async function RunPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: SP }) {
  const { runId } = await params;
  const sp = await searchParams;
  const run = getRun(Number(runId));
  if (!run) notFound();
  const employer = getEmployer(run.employer_id)!;
  const entries = listEntries(run.id);
  const t = runTotals(run.id);
  const editable = ["DRAFT", "CALCULATED"].includes(run.status);
  const slips = new Map((getDb().prepare("SELECT employee_payroll_id, id FROM payslips WHERE run_id = ?").all(run.id) as { employee_payroll_id: number; id: number }[]).map((r) => [r.employee_payroll_id, r.id]));
  const batch = getDb().prepare("SELECT id FROM payment_batches WHERE run_id = ?").get(run.id) as { id: number } | undefined;

  return (
    <>
      <PageHead title={`הרצת שכר ${periodIL(run.year, run.month)}`} sub={<>{employer.name} · תשלום {dateIL(run.payment_date)} · <span className={`badge ${RUN_STATUS[run.status]?.cls}`}>{RUN_STATUS[run.status]?.label}</span></>}>
        {editable && <form action={calculateRunAction.bind(null, run.id)}><button className="btn" type="submit">חשב את כל העובדים</button></form>}
        {run.status === "CALCULATED" && <form action={approveRunAction.bind(null, run.id)}><button className="btn" type="submit" style={{ background: "var(--ok)", borderColor: "var(--ok)" }}>אישור ונעילה – הפקת תלושים</button></form>}
        {batch && <Link className="btn secondary" href={`/payments?batch=${batch.id}`}>תשלומים</Link>}
      </PageHead>
      <Flash sp={sp} />
      <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
        <Stat k="עובדים" v={t.employees} />
        <Stat k="ברוטו" v={ils(t.gross)} />
        <Stat k="נטו לתשלום" v={ils(t.netToPay)} />
        <Stat k="עלות מעסיק" v={ils(t.employerCost)} />
      </div>
      {editable && (
        <div className="msg INFO">שלבים: הזינו נתוני חודש לכל עובד (לחיצה על השם) ← &quot;חשב&quot; ← בדקו אזהרות ו&quot;כיצד חושב?&quot; ← &quot;אישור ונעילה&quot;. לאחר האישור נוצרים תלושים קבועים ותשלומים.</div>
      )}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>עובד</th><th>סטטוס</th><th>הודעות</th><th className="num">ברוטו</th><th className="num">מס</th><th className="num">ב״ל+בריאות</th><th className="num">נטו לתשלום</th><th className="num">עלות מעסיק</th><th></th></tr></thead>
          <tbody>
            {entries.map((e) => {
              const r = json<PayrollResult | null>(e.result_json, null);
              const msgs = json<Message[]>(e.messages_json, []);
              const errs = msgs.filter((m) => m.level === "ERROR").length, warns = msgs.filter((m) => m.level === "WARNING").length;
              return (
                <tr key={e.id} className={e.status === "ERROR" ? "row-err" : ""}>
                  <td><Link href={`/payroll/${run.id}/${e.id}`}>{e.first_name} {e.last_name}</Link></td>
                  <td>{e.status === "CALCULATED" ? <span className="badge ok">חושב</span> : e.status === "ERROR" ? <span className="badge err">שגיאה</span> : <span className="badge">ממתין</span>}</td>
                  <td>{errs ? <span className="badge err">{errs} שגיאות</span> : null} {warns ? <span className="badge warn">{warns} אזהרות</span> : null}</td>
                  <td className="num"><Money v={r?.totals.grossPay} /></td>
                  <td className="num"><Money v={r?.tax.incomeTax} /></td>
                  <td className="num"><Money v={r ? r.ni.employee + r.ni.health : null} /></td>
                  <td className="num"><Money v={r?.totals.netToPay} strong /></td>
                  <td className="num"><Money v={r?.totals.employerCost} /></td>
                  <td>{slips.get(e.id) && <Link href={`/payslips/${slips.get(e.id)}`}>תלוש</Link>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={3}>סה״כ</td><td className="num"><Money v={t.gross} /></td><td className="num"><Money v={t.tax} /></td><td className="num"><Money v={t.ni + t.health} /></td><td className="num"><Money v={t.netToPay} /></td><td className="num"><Money v={t.employerCost} /></td><td></td></tr></tfoot>
        </table>
      </div>
      <div className="card no-print">
        {editable && (
          <form action={deleteRunAction.bind(null, run.id)}><button className="btn danger small" type="submit">מחיקת טיוטת ההרצה</button></form>
        )}
        {["APPROVED", "PAID"].includes(run.status) && (
          <details>
            <summary>ביטול הרצה מאושרת</summary>
            <p className="muted small">התלושים לא נמחקים – הם מסומנים &quot;בוטל&quot; ונשמרים להיסטוריה. התשלומים מבוטלים. אחר כך אפשר ליצור הרצה חדשה לאותו חודש.</p>
            <form action={reverseRunAction.bind(null, run.id)} className="actions">
              <input name="reason" placeholder="סיבת הביטול" required style={{ maxWidth: 320 }} />
              <button className="btn danger small" type="submit">ביטול ההרצה</button>
            </form>
          </details>
        )}
      </div>
    </>
  );
}
