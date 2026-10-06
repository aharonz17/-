import { BANKS } from "@/domain/bank/banks";
import type { Employer } from "@/server/repo";
import { F } from "@/components/ui";

export function EmployerForm({ action, e, submit }: { action: (fd: FormData) => Promise<void>; e?: Employer; submit: string }) {
  return (
    <form action={action} className="stack">
      <fieldset>
        <legend>פרטי מעסיק</legend>
        <div className="fields">
          <F label="שם המעסיק *"><input name="name" required defaultValue={e?.name} /></F>
          <F label="ח.פ / ע.מ"><input name="company_id" defaultValue={e?.company_id ?? ""} inputMode="numeric" /></F>
          <F label="תיק ניכויים"><input name="deductions_file" defaultValue={e?.deductions_file ?? ""} inputMode="numeric" /></F>
          <F label="תיק ביטוח לאומי"><input name="ni_file" defaultValue={e?.ni_file ?? ""} inputMode="numeric" /></F>
          <F label="מגזר (לדמי הבראה)">
            <select name="sector" defaultValue={e?.sector ?? "private"}>
              <option value="private">פרטי</option>
              <option value="public">ציבורי</option>
            </select>
          </F>
          <F label="תאריך התחלה"><input type="date" name="start_date" defaultValue={e?.start_date ?? ""} /></F>
          <F label="סטטוס">
            <select name="status" defaultValue={e?.status ?? "ACTIVE"}><option value="ACTIVE">פעיל</option><option value="INACTIVE">לא פעיל</option></select>
          </F>
        </div>
      </fieldset>
      <fieldset>
        <legend>פרטי קשר</legend>
        <div className="fields">
          <F label="כתובת"><input name="address" defaultValue={e?.address ?? ""} /></F>
          <F label="עיר"><input name="city" defaultValue={e?.city ?? ""} /></F>
          <F label="טלפון"><input name="phone" defaultValue={e?.phone ?? ""} /></F>
          <F label="דוא״ל"><input name="email" type="email" defaultValue={e?.email ?? ""} /></F>
        </div>
      </fieldset>
      <fieldset>
        <legend>חשבון בנק ומס״ב</legend>
        <div className="fields">
          <F label="בנק">
            <select name="bank_code" defaultValue={e?.bank_code ?? ""}>
              <option value="">—</option>
              {BANKS.filter((b) => b.active).map((b) => <option key={b.code} value={b.code}>{b.code} – {b.name}</option>)}
            </select>
          </F>
          <F label="סניף"><input name="branch" defaultValue={e?.branch ?? ""} inputMode="numeric" /></F>
          <F label="מספר חשבון"><input name="account" defaultValue={e?.account ?? ""} inputMode="numeric" /></F>
          <F label="קוד מוסד במס״ב (8 ספרות)"><input name="masav_institution_code" defaultValue={e?.masav_institution_code ?? ""} inputMode="numeric" /></F>
          <F label="קוד מוסד שולח (5 ספרות)"><input name="masav_sender_code" defaultValue={e?.masav_sender_code ?? ""} inputMode="numeric" /></F>
        </div>
      </fieldset>
      <div className="actions"><button className="btn" type="submit">{submit}</button></div>
    </form>
  );
}
