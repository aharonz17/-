import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntry, getRun, listEntries, defaultEntryInput, type RunEntryInput } from "@/server/payroll";
import { currentEmployment, getEmployee } from "@/server/repo";
import { json, getDb } from "@/server/db";
import { PageHead, Flash, Messages, F, type SP } from "@/components/ui";
import { ResultSummary, ResultLines, TraceView } from "@/components/payroll-result";
import { EXTRA, EXTRA_TYPES } from "@/domain/payroll/catalog";
import { periodEnd } from "@/domain/payroll/dates";
import type { Message, PayrollResult } from "@/domain/payroll/types";
import { periodIL, RUN_STATUS } from "@/lib/format";
import { saveEntryAction, recalcEntryAction } from "../../actions";

export default async function EntryPage({ params, searchParams }: { params: Promise<{ runId: string; epId: string }>; searchParams: SP }) {
  const { runId, epId } = await params;
  const sp = await searchParams;
  const run = getRun(Number(runId));
  const entry = getEntry(Number(epId));
  if (!run || !entry || entry.run_id !== run.id) notFound();
  const employee = getEmployee(entry.employee_id)!;
  const employment = currentEmployment(employee.id, periodEnd(run.year, run.month));
  const input = json<RunEntryInput>(entry.input_json, employment ? defaultEntryInput(employment, run.year, run.month) : { attendance: { workDays: 0 }, components: [] });
  const result = json<PayrollResult | null>(entry.result_json, null);
  const messages = json<Message[]>(entry.messages_json, []);
  const editable = ["DRAFT", "CALCULATED"].includes(run.status);
  const all = listEntries(run.id);
  const idx = all.findIndex((e) => e.id === entry.id);
  const prev = all[idx - 1], next = all[idx + 1];
  const slip = getDb().prepare("SELECT id FROM payslips WHERE employee_payroll_id = ?").get(entry.id) as { id: number } | undefined;
  const a = input.attendance;
  const comps = [...input.components, {}, {}, {}] as { type?: string; description?: string; amount?: number; quantity?: number; rate?: number }[];
  const sick = (a.sickEpisodes ?? []).map((s) => (s.continuesFromDay ? `${s.days}+${s.continuesFromDay}` : String(s.days))).join(",");
  const isHourly = employment?.pay_type === "hourly";
  const resultBlock = result && (
    <>
      <h2>תוצאה</h2>
      <ResultSummary r={result} />
      <div style={{ marginTop: "1rem" }}><ResultLines r={result} /></div>
      <TraceView r={result} />
    </>
  );

  return (
    <>
      <PageHead
        title={`${employee.first_name} ${employee.last_name} – ${periodIL(run.year, run.month)}`}
        sub={<><Link href={`/payroll/${run.id}`}>הרצה #{run.id}</Link> · <span className={`badge ${RUN_STATUS[run.status]?.cls}`}>{RUN_STATUS[run.status]?.label}</span> · <Link href={`/employees/${employee.id}`}>כרטיס עובד</Link></>}>
        {prev && <Link className="btn secondary small" href={`/payroll/${run.id}/${prev.id}`}>→ הקודם</Link>}
        {next && <Link className="btn secondary small" href={`/payroll/${run.id}/${next.id}`}>הבא ←</Link>}
        {slip && <Link className="btn" href={`/payslips/${slip.id}`}>לתלוש</Link>}
      </PageHead>
      <Flash sp={sp} />
      <Messages list={messages} />
      {!editable && resultBlock}

      <form action={saveEntryAction.bind(null, run.id, entry.id)} className="stack card no-print">
        <h2 style={{ marginTop: 0 }}>נתוני החודש</h2>
        <fieldset disabled={!editable}>
          <legend>נוכחות</legend>
          <div className="fields">
            <F label="ימי עבודה בפועל"><input name="workDays" inputMode="decimal" defaultValue={a.workDays} /></F>
            {isHourly && <F label="שעות רגילות"><input name="regularHours" inputMode="decimal" defaultValue={a.regularHours ?? 0} /></F>}
            <F label="ש״נ 125%"><input name="ot125" inputMode="decimal" defaultValue={a.ot125 ?? 0} /></F>
            <F label="ש״נ 150%"><input name="ot150" inputMode="decimal" defaultValue={a.ot150 ?? 0} /></F>
            <F label="מנוחה שבועית 150%"><input name="rest150" inputMode="decimal" defaultValue={a.rest150 ?? 0} /></F>
            <F label="ש״נ במנוחה 175%"><input name="rest175" inputMode="decimal" defaultValue={a.rest175 ?? 0} /></F>
            <F label="ש״נ במנוחה 200%"><input name="rest200" inputMode="decimal" defaultValue={a.rest200 ?? 0} /></F>
            <F label="עבודה בחג 150%"><input name="holiday150" inputMode="decimal" defaultValue={a.holiday150 ?? 0} /></F>
            <F label="ימי חופשה"><input name="vacationDays" inputMode="decimal" defaultValue={a.vacationDays ?? 0} /></F>
            <F label="ימי מחלה לפי רצפים (3,2 · המשך: 2+5)"><input name="sick_episodes" defaultValue={sick} className="ltr" /></F>
            <F label="היעדרות ללא תשלום (ימים)"><input name="unpaidDays" inputMode="decimal" defaultValue={a.unpaidDays ?? 0} /></F>
            {employment?.pay_type !== "monthly" && <F label="ימי חג בתשלום"><input name="holidayPaidDays" inputMode="decimal" defaultValue={a.holidayPaidDays ?? 0} /></F>}
            <F label="ימי הבראה לתשלום החודש"><input name="recoveryDays" inputMode="decimal" defaultValue={input.recoveryDays ?? ""} /></F>
          </div>
        </fieldset>
        <fieldset disabled={!editable}>
          <legend>רכיבים חד-פעמיים (בונוס, עמלה, החזר, מקדמה, הלוואה…)</legend>
          <p className="muted small">רכיבים קבועים מוגדרים בכרטיס העובד ומתווספים אוטומטית. אפשר להזין סכום, או כמות × תעריף.</p>
          {comps.map((c, i) => (
            <div className="fields" key={i} style={{ marginBottom: "0.5rem" }}>
              <F label="סוג">
                <select name={`c_type_${i}`} defaultValue={c.type ?? ""}>
                  <option value="">—</option>
                  {EXTRA_TYPES.map((t) => <option key={t} value={t}>{EXTRA[t].name}</option>)}
                </select>
              </F>
              <F label="תיאור"><input name={`c_desc_${i}`} defaultValue={c.description ?? ""} /></F>
              <F label="סכום (₪)"><input name={`c_amount_${i}`} inputMode="decimal" defaultValue={c.amount ?? ""} /></F>
              <F label="או כמות"><input name={`c_qty_${i}`} inputMode="decimal" defaultValue={c.amount === undefined ? c.quantity ?? "" : ""} /></F>
              <F label="× תעריף"><input name={`c_rate_${i}`} inputMode="decimal" defaultValue={c.amount === undefined ? c.rate ?? "" : ""} /></F>
            </div>
          ))}
          <input type="hidden" name="c_count" value={comps.length} />
          <F label="הערה" wide><input name="note" defaultValue={input.note ?? ""} /></F>
        </fieldset>
        {editable && <div className="actions"><button className="btn" type="submit">שמירה וחישוב</button></div>}
      </form>
      {editable && !result && entry.status !== "ERROR" && (
        <form action={recalcEntryAction.bind(null, run.id, entry.id)} className="no-print" style={{ marginBottom: "1rem" }}><button className="btn secondary" type="submit">חישוב עם ברירות המחדל</button></form>
      )}

      {editable && resultBlock}
    </>
  );
}
