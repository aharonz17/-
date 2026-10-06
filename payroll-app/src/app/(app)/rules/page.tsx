import { listRuleRows, addRuleVersion, closeRuleVersion, loadRuleVersions } from "@/server/rules";
import { findOverlaps } from "@/domain/rules/resolve";
import { runAction } from "@/lib/action";
import { audit } from "@/server/audit";
import { date, reqStr, str, bool } from "@/lib/form";
import { PageHead, Flash, F, type SP } from "@/components/ui";
import { dateIL } from "@/lib/format";
import type { RuleKey } from "@/domain/rules/types";

const LABELS: Record<string, string> = {
  "income_tax.brackets": "מדרגות מס הכנסה (חודשי)", "credit_point.value": "ערך נקודת זיכוי", "credit_points.personal": "נקודות זיכוי אישיות",
  "credit_points.children": "נקודות זיכוי לילדים", "credit_points.toddler_addition": "תוספת לפעוטות (2024)", "credit_points.discharged_soldier": "חייל משוחרר",
  "credit_points.degree": "תואר אקדמי", "credit_points.new_immigrant": "עולה חדש", "credit_points.reserve_combat": "לוחמי מילואים",
  "national_insurance.rates": "ביטוח לאומי ובריאות", min_wage: "שכר מינימום", work_hours: "שעות עבודה", "overtime.rates": "שעות נוספות",
  recovery_pay: "דמי הבראה", "vacation.accrual": "צבירת חופשה", "sick.rules": "דמי מחלה", "travel.cap": "נסיעות", "pension.mandatory": "פנסיה חובה",
  "pension.tax": "הטבות מס פנסיה", study_fund: "קרן השתלמות", car_benefit: "שווי רכב", phone_benefit: "שווי טלפון", secondary_employment: "משכורת נוספת", severance: "פיצויים",
};

async function addAction(fd: FormData) {
  "use server";
  await runAction("/rules", (actor) => {
    const key = reqStr(fd, "key", "מפתח") as RuleKey;
    let payload: unknown;
    try { payload = JSON.parse(reqStr(fd, "payload", "ערכים (JSON)")); } catch { throw new Error("ה-JSON אינו תקין."); }
    const from = date(fd, "from");
    if (!from) throw new Error("חסר תאריך תחילת תוקף");
    const r = { key, version: reqStr(fd, "version", "שם גרסה"), effectiveFrom: from, effectiveTo: date(fd, "to"), payload: payload as never,
      source: { name: reqStr(fd, "source_name", "מקור"), url: str(fd, "source_url") ?? undefined }, verified: bool(fd, "verified"), notes: str(fd, "notes") ?? undefined };
    const overlaps = findOverlaps([...loadRuleVersions(), r]);
    if (overlaps.length) throw new Error(`חפיפה בתקופות תוקף: ${overlaps.join("; ")}. סגרו קודם את הגרסה הקודמת.`);
    addRuleVersion(r);
    audit({ entityType: "rule", entityId: `${key}@${r.version}`, action: "CREATE", actor, newValue: r });
    return { ok: "גרסת כלל נוספה" };
  });
}

async function closeAction(id: string, fd: FormData) {
  "use server";
  await runAction("/rules", (actor) => {
    const to = date(fd, "to");
    if (!to) throw new Error("חסר תאריך סיום");
    closeRuleVersion(id, to);
    audit({ entityType: "rule", entityId: id, action: "CLOSE", actor, newValue: { effectiveTo: to } });
    return { ok: "תוקף הגרסה עודכן" };
  });
}

export default async function RulesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const rows = listRuleRows();
  const keys = [...new Set(rows.map((r) => r.key))];
  const base = typeof sp.from_rule === "string" ? rows.find((r) => r.id === sp.from_rule) : undefined;
  return (
    <>
      <PageHead title="כללי חישוב" sub="כל מספר שהמנוע משתמש בו נשמר כאן עם תקופת תוקף ומקור. שנה חדשה = גרסה חדשה, בלי לשנות קוד." />
      <Flash sp={sp} />
      <div className="msg WARNING">כללים המסומנים &quot;לא מאומת&quot; נאספו ממקורות משניים. לפני הפקת שכר אמיתי – אמתו מול רשות המסים / ביטוח לאומי / כל-זכות, וסמנו גרסה מאומתת.</div>
      {keys.map((k) => (
        <details key={k} className="card">
          <summary>{LABELS[k] ?? k} <span className="muted small ltr">{k}</span> {rows.some((r) => r.key === k && !r.verified) && <span className="badge warn">יש גרסה לא מאומתת</span>}</summary>
          <table style={{ marginTop: "0.5rem" }}>
            <thead><tr><th>גרסה</th><th>תוקף</th><th>מקור</th><th>מאומת</th><th>ערכים</th><th></th></tr></thead>
            <tbody>
              {rows.filter((r) => r.key === k).map((r) => (
                <tr key={r.id}>
                  <td>{r.version}<div className="small muted">{r.origin === "user" ? "נוסף ידנית" : "מקורי"}</div></td>
                  <td className="small">{dateIL(r.effective_from)} – {r.effective_to ? dateIL(r.effective_to) : "ואילך"}</td>
                  <td className="small">{r.source_url ? <a href={r.source_url} target="_blank" rel="noreferrer">{r.source_name}</a> : r.source_name}{r.notes && <div className="muted">{r.notes}</div>}</td>
                  <td>{r.verified ? <span className="badge ok">כן</span> : <span className="badge warn">לא</span>}</td>
                  <td><pre className="ltr small" style={{ margin: 0, maxWidth: 420, whiteSpace: "pre-wrap" }}>{JSON.stringify(JSON.parse(r.payload_json))}</pre></td>
                  <td className="small">
                    <a href={`/rules?from_rule=${encodeURIComponent(r.id)}#new`}>גרסה חדשה מזו</a>
                    {!r.effective_to && (
                      <form action={closeAction.bind(null, r.id)} className="actions" style={{ marginTop: 4 }}>
                        <input type="date" name="to" required style={{ maxWidth: 150 }} /><button className="btn secondary small" type="submit">סגירת תוקף</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      <div className="card" id="new">
        <h2 style={{ marginTop: 0 }}>הוספת גרסת כלל</h2>
        <form action={addAction} className="stack">
          <div className="fields">
            <F label="מפתח"><select name="key" defaultValue={base?.key ?? ""}>{keys.map((k) => <option key={k} value={k}>{LABELS[k] ?? k}</option>)}</select></F>
            <F label="שם גרסה (למשל 2027)"><input name="version" required /></F>
            <F label="בתוקף מ"><input type="date" name="from" required /></F>
            <F label="בתוקף עד (ריק = ואילך)"><input type="date" name="to" /></F>
            <F label="מקור"><input name="source_name" required /></F>
            <F label="קישור למקור"><input name="source_url" className="ltr" /></F>
            <label className="check"><input type="checkbox" name="verified" /> אומת מול מקור רשמי</label>
            <F label="הערות"><input name="notes" /></F>
          </div>
          <F label="ערכים (JSON באותו מבנה כמו הגרסה הקודמת)" wide>
            <textarea name="payload" rows={8} className="ltr" defaultValue={base ? JSON.stringify(JSON.parse(base.payload_json), null, 2) : ""} required />
          </F>
          <div><button className="btn" type="submit">הוספה</button></div>
        </form>
      </div>
    </>
  );
}
