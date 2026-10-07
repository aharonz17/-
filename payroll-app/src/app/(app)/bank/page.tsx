import Link from "next/link";
import { listAccounts, statementFor } from "@/server/bank";
import { PageHead, Money, Flash, type SP } from "@/components/ui";
import { maskAccount } from "@/lib/format";

export default async function BankPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const accounts = listAccounts();
  return (
    <>
      <PageHead title="חשבונות בנק" sub="ייבוא דפי עו״ש אמיתיים, או חשבונות הדמיה לבדיקות.">
        <Link className="btn" href="/bank/new">+ חשבון חדש</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="card table-wrap">
        {accounts.length ? (
          <table>
            <thead><tr><th>בעל החשבון</th><th>בנק</th><th>סניף / חשבון</th><th>סוג</th><th>תנועות</th><th>התאמת יתרות</th><th className="num">יתרה נוכחית</th></tr></thead>
            <tbody>
              {accounts.map((a) => {
                const st = statementFor(a.id);
                return (
                  <tr key={a.id} className={a.kind === "SIMULATED" ? "row-sim" : ""}>
                    <td><Link href={`/bank/${a.id}`}>{a.holder}</Link></td>
                    <td>{a.bank_code} – {a.bank_name}</td>
                    <td className="ltr">{a.branch}/{maskAccount(a.account_number)}</td>
                    <td>{a.kind === "SIMULATED" ? <span className="badge sim">הדמיה</span> : <span className="badge">אמיתי</span>}</td>
                    <td>{a.txn_count}</td>
                    <td>{st.balanced ? <span className="badge ok">תקין</span> : <span className="badge err">{st.errors.length} פערים</span>}</td>
                    <td className="num"><Money v={st.closingBalance} strong /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="muted">אין חשבונות. <Link href="/bank/new">צרו חשבון</Link> – אמיתי (לייבוא מהבנק) או הדמיה.</p>}
      </div>
    </>
  );
}
