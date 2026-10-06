import { BANKS } from "@/domain/bank/banks";
import { listEmployers, listEmployees } from "@/server/repo";
import { PageHead, Flash, F, type SP } from "@/components/ui";
import { createAccountAction } from "../actions";

export default async function NewAccount({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const employers = listEmployers();
  const employees = listEmployees();
  return (
    <>
      <PageHead title="חשבון בנק חדש" />
      <Flash sp={sp} />
      <form action={createAccountAction} className="stack card">
        <fieldset>
          <legend>סוג החשבון</legend>
          <label className="check"><input type="radio" name="kind" value="REAL" defaultChecked={sp.kind !== "SIMULATED"} /> חשבון אמיתי – תנועות מיובאות מקובץ שהורדתם מהבנק</label>
          <label className="check"><input type="radio" name="kind" value="SIMULATED" defaultChecked={sp.kind === "SIMULATED"} /> חשבון הדמיה – לבדיקות והדגמות (מסומן &quot;הדמיה&quot; בכל מקום)</label>
          <p className="muted small">המערכת לא מתחברת לבנק ולא מבקשת סיסמאות. נתונים אמיתיים נכנסים רק מקבצים שאתם מורידים.</p>
        </fieldset>
        <div className="fields">
          <F label="בנק *">
            <select name="bank_code" required defaultValue="">
              <option value="" disabled>בחרו…</option>
              {BANKS.filter((b) => b.active).map((b) => <option key={b.code} value={b.code}>{b.code} – {b.name}</option>)}
            </select>
          </F>
          <F label="סניף"><input name="branch" inputMode="numeric" /></F>
          <F label="מספר חשבון *"><input name="account_number" required inputMode="numeric" /></F>
          <F label="בעל החשבון *"><input name="holder" required /></F>
          <F label="יתרת פתיחה (₪)"><input name="opening_balance" inputMode="decimal" defaultValue="0" /></F>
          <F label="תאריך יתרת פתיחה"><input type="date" name="opening_date" /></F>
          <F label="שייך ל">
            <select name="owner_type" defaultValue="other"><option value="other">אחר</option><option value="employer">מעסיק</option><option value="employee">עובד</option></select>
          </F>
          <F label="מעסיק (אם שייך למעסיק)">
            <select name="owner_id_employer" defaultValue=""><option value="">—</option>{employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          </F>
          <F label="עובד (אם שייך לעובד)">
            <select name="owner_id_employee" defaultValue=""><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select>
          </F>
        </div>
        <div className="actions"><button className="btn" type="submit">יצירת חשבון</button></div>
      </form>
    </>
  );
}
