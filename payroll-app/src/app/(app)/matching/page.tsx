import Link from "next/link";
import { getDb } from "@/server/db";
import { listMatches, listPayments, suggestMatches } from "@/server/bank";
import { PageHead, Flash, Money, type SP } from "@/components/ui";
import { dateIL } from "@/lib/format";
import { autoMatchAction, confirmAction, unmatchAction } from "./actions";

const STATUS: Record<string, { label: string; cls: string }> = {
  CONFIRMED: { label: "ודאי", cls: "ok" }, VERY_LIKELY: { label: "סביר מאוד", cls: "info" }, POSSIBLE: { label: "אפשרי", cls: "warn" },
};

export default async function MatchingPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const suggestions = suggestMatches();
  const matches = listMatches();
  const pending = listPayments({ status: "PENDING" });
  const txnInfo = (id: number) => getDb().prepare("SELECT t.transaction_date, t.description, t.amount, a.holder, a.kind, a.id account_id FROM bank_transactions t JOIN bank_accounts a ON a.id = t.account_id WHERE t.id = ?").get(id) as
    { transaction_date: string; description: string; amount: number; holder: string; kind: string; account_id: number };
  const payInfo = new Map(pending.map((p) => [p.id, p]));
  const unmatched = pending.filter((p) => !suggestions.some((s) => s.paymentId === p.id));

  return (
    <>
      <PageHead title="התאמות שכר ↔ בנק" sub="המערכת מחפשת לכל תשלום שכר תנועת זכות מתאימה בחשבונות הבנק – לפי סכום, תאריך, שמות ואסמכתא.">
        <form action={autoMatchAction}><button className="btn" type="submit">אישור אוטומטי של כל ההתאמות הוודאיות</button></form>
      </PageHead>
      <Flash sp={sp} />
      <div className="card table-wrap">
        <h2>הצעות התאמה ({suggestions.length})</h2>
        <table>
          <thead><tr><th>תשלום</th><th className="num">סכום</th><th>תנועת בנק</th><th>ציון</th><th>נימוקים</th><th></th></tr></thead>
          <tbody>
            {suggestions.map((s) => {
              const p = payInfo.get(s.paymentId)!, t = txnInfo(s.txnId);
              return (
                <tr key={`${s.paymentId}-${s.txnId}`}>
                  <td>{p?.beneficiary_name}<div className="small muted">{dateIL(p?.payment_date)} · {p?.employer_name}</div></td>
                  <td className="num"><Money v={p?.amount} /></td>
                  <td><Link href={`/bank/${t.account_id}`}>{t.holder}</Link> {t.kind === "SIMULATED" && <span className="badge sim">הדמיה</span>}<div className="small muted">{dateIL(t.transaction_date)} · {t.description} · <Money v={t.amount} /></div></td>
                  <td><span className={`badge ${STATUS[s.status]?.cls}`}>{STATUS[s.status]?.label} {s.score}%</span></td>
                  <td className="small">{s.reasons.join(" · ")}</td>
                  <td><form action={confirmAction.bind(null, s.paymentId, s.txnId)}><button className="btn small" type="submit">אישור</button></form></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!suggestions.length && <p className="muted">אין הצעות. ייבאו דף חשבון של העובד/המעסיק או רשמו את התשלום בחשבון הדמיה (מסך תשלומים).</p>}
      </div>
      {unmatched.length > 0 && (
        <div className="card table-wrap">
          <h2>תשלומים ללא תנועה מתאימה ({unmatched.length})</h2>
          <table>
            <thead><tr><th>מוטב</th><th>תאריך</th><th className="num">סכום</th><th>אסמכתא</th></tr></thead>
            <tbody>{unmatched.map((p) => <tr key={p.id}><td>{p.beneficiary_name}</td><td>{dateIL(p.payment_date)}</td><td className="num"><Money v={p.amount} /></td><td className="ltr small">{p.reference}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="card table-wrap">
        <h2>התאמות שאושרו ({matches.length})</h2>
        <table>
          <thead><tr><th>מוטב</th><th className="num">סכום</th><th>תנועה</th><th>ציון</th><th>נימוקים</th><th></th></tr></thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id}>
                <td>{m.beneficiary_name}<div className="small muted">{dateIL(m.payment_date)}</div></td>
                <td className="num"><Money v={m.payment_amount} /></td>
                <td><Link href={`/bank/${m.account_id}`}>{m.account_holder}</Link> {m.account_kind === "SIMULATED" && <span className="badge sim">הדמיה</span>}<div className="small muted">{dateIL(m.transaction_date)} · {m.description}</div></td>
                <td>{m.score}%</td>
                <td className="small">{(JSON.parse(m.reasons_json) as string[]).join(" · ")}</td>
                <td><form action={unmatchAction.bind(null, m.payment_id)}><button className="btn secondary small" type="submit">ביטול שיוך</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
