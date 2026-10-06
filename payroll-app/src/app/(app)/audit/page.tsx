import { listAudit } from "@/server/audit";
import { PageHead, type SP } from "@/components/ui";

const ENTITY: Record<string, string> = {
  employer: "מעסיק", employee: "עובד", employment: "העסקה", tax_profile: "פרופיל מס", payroll_run: "הרצת שכר", employee_payroll: "נתוני עובד בהרצה",
  bank_account: "חשבון בנק", bank_transaction: "תנועת בנק", bank_import: "ייבוא", payment: "תשלום", payment_batch: "אצוות תשלום", rule: "כלל",
};

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const type = typeof sp.type === "string" ? sp.type : undefined;
  const rows = listAudit({ entityType: type, limit: 300 });
  return (
    <>
      <PageHead title="יומן שינויים" sub="כל שינוי משמעותי נרשם כאן. רשומות לא נמחקות." />
      <form className="actions card" method="get">
        <select name="type" defaultValue={type ?? ""} style={{ maxWidth: 240 }}>
          <option value="">כל הסוגים</option>
          {Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn secondary" type="submit">סינון</button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>זמן</th><th>משתמש</th><th>ישות</th><th>פעולה</th><th>פרטים</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{r.created_at}</td>
                <td>{r.actor}</td>
                <td>{ENTITY[r.entity_type] ?? r.entity_type} <span className="ltr small muted">#{r.entity_id}</span></td>
                <td>{r.action}{r.reason && <div className="small muted">{r.reason}</div>}</td>
                <td>
                  {(r.new_value || r.old_value) && (
                    <details><summary className="small">הצגה</summary>
                      {r.old_value && <pre className="ltr small" style={{ whiteSpace: "pre-wrap", maxWidth: 600 }}>לפני: {r.old_value.slice(0, 3000)}</pre>}
                      {r.new_value && <pre className="ltr small" style={{ whiteSpace: "pre-wrap", maxWidth: 600 }}>אחרי: {r.new_value.slice(0, 3000)}</pre>}
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
