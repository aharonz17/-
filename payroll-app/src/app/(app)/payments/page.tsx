import Link from "next/link";
import { listBatches, listPayments, listAccounts } from "@/server/bank";
import { PageHead, Flash, Money, type SP } from "@/components/ui";
import { dateIL, periodIL, PAYMENT_STATUS, maskAccount } from "@/lib/format";
import { postToSimAction } from "../matching/actions";
import { MASAV_VERIFIED } from "@/domain/bank/masav";

export default async function PaymentsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const batchId = Number(sp.batch) || undefined;
  const batches = listBatches();
  const payments = listPayments({ batchId });
  const simAccounts = listAccounts().filter((a) => a.kind === "SIMULATED");
  return (
    <>
      <PageHead title="תשלומים" sub="תשלומי שכר נוצרים אוטומטית באישור הרצת שכר." />
      <Flash sp={sp} />
      <div className="card table-wrap">
        <h2>אצוות תשלום</h2>
        {!MASAV_VERIFIED && <p className="msg WARNING">מבנה קובץ מס״ב נבנה לפי ידע כללי ולא אומת מול המפרט הרשמי. לפני העלאה לבנק – בדקו מול הבנק. המערכת לא שולחת דבר החוצה.</p>}
        <table>
          <thead><tr><th>#</th><th>מעסיק</th><th>תקופה</th><th>תאריך תשלום</th><th>תשלומים</th><th className="num">סכום</th><th>קבצים</th></tr></thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/payments?batch=${b.id}`}>{b.id}</Link></td>
                <td>{b.employer_name}</td>
                <td>{b.year ? <Link href={`/payroll/${b.run_id}`}>{periodIL(b.year, b.month!)}</Link> : ""}</td>
                <td>{dateIL(b.payment_date)}</td>
                <td>{b.payment_count}</td>
                <td className="num"><Money v={b.total_amount} /></td>
                <td className="actions"><a href={`/api/batches/${b.id}/masav`}>קובץ מס״ב</a> · <a href={`/api/batches/${b.id}/csv`}>CSV</a></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!batches.length && <p className="muted">אין אצוות.</p>}
      </div>
      <div className="card table-wrap">
        <h2>{batchId ? `תשלומים באצווה #${batchId}` : "כל התשלומים"} {batchId && <Link className="small" href="/payments">(הצג הכל)</Link>}</h2>
        <table>
          <thead><tr><th>מוטב</th><th>חשבון</th><th>תאריך</th><th>אסמכתא</th><th>סטטוס</th><th className="num">סכום</th><th></th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{p.employee_id ? <Link href={`/employees/${p.employee_id}`}>{p.beneficiary_name}</Link> : p.beneficiary_name}</td>
                <td className="ltr">{p.bank_code}-{p.branch}-{maskAccount(p.account)}</td>
                <td>{dateIL(p.payment_date)}</td>
                <td className="ltr small">{p.reference}</td>
                <td><span className={`badge ${PAYMENT_STATUS[p.status]?.cls}`}>{PAYMENT_STATUS[p.status]?.label}</span>{p.match_score !== null && <span className="small muted"> ({p.match_score}%)</span>}</td>
                <td className="num"><Money v={p.amount} /></td>
                <td>
                  {p.status === "PENDING" && simAccounts.length > 0 && (
                    <form action={postToSimAction.bind(null, p.id)} className="actions">
                      <select name="account_id" style={{ maxWidth: 180 }}>{simAccounts.map((a) => <option key={a.id} value={a.id}>{a.holder}</option>)}</select>
                      <button className="btn secondary small" type="submit">רשום בחשבון הדמיה</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!payments.length && <p className="muted">אין תשלומים.</p>}
      </div>
    </>
  );
}
