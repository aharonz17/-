import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayslip } from "@/server/payroll";
import { getDb } from "@/server/db";
import { PageHead, Messages } from "@/components/ui";
import { TraceView } from "@/components/payroll-result";
import { periodIL } from "@/lib/format";

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getPayslip(Number(id));
  if (!p) notFound();
  const s = p.snapshot;
  const payment = getDb().prepare(`SELECT p.id, p.status, m.transaction_id, t.account_id FROM payments p LEFT JOIN transaction_matches m ON m.payment_id = p.id
    LEFT JOIN bank_transactions t ON t.id = m.transaction_id WHERE p.payslip_id = ?`).get(p.id) as { id: number; status: string; transaction_id: number | null; account_id: number | null } | undefined;
  return (
    <>
      <PageHead title={`תלוש ${periodIL(p.year, p.month)} – ${s.employee.first_name} ${s.employee.last_name}`}
        sub={<>{s.employer.name} · <Link href={`/payroll/${p.run_id}`}>הרצה #{p.run_id}</Link> · {p.status === "FINAL" ? <span className="badge ok">סופי</span> : <span className="badge err">בוטל</span>}
          {" "}· {p.integrityOk ? <span className="badge ok">שלמות נתונים תקינה</span> : <span className="badge err">הנתונים שונו אחרי ההפקה!</span>}</>}>
        <a className="btn" href={`/api/payslips/${p.id}/pdf`} target="_blank" rel="noreferrer">פתיחה / הדפסה / הורדה (PDF)</a>
        {payment && (payment.transaction_id
          ? <Link className="btn secondary" href={`/bank/${payment.account_id}`}>שויך לתנועת בנק ✓</Link>
          : <Link className="btn secondary" href="/matching">מצא תנועת בנק מתאימה</Link>)}
      </PageHead>
      <iframe src={`/api/payslips/${p.id}/html`} title="תלוש" style={{ width: "100%", height: "1150px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff" }} />
      <div style={{ marginTop: "1rem" }}>
        <Messages list={s.result.messages.filter((m) => m.level !== "INFO")} />
        <TraceView r={s.result} />
      </div>
    </>
  );
}
