"use server";
import { runAction } from "@/lib/action";
import { date, num, num0, str } from "@/lib/form";
import {
  approveRun, calculateEntry, calculateRun, createRun, deleteDraftRun, getEntry, reverseRun, updateEntryInput, runTotals,
  type RunEntryInput,
} from "@/server/payroll";
import { getDb } from "@/server/db";
import { EXTRA_TYPES } from "@/domain/payroll/catalog";
import type { ExtraComponent, ExtraComponentType } from "@/domain/payroll/types";

export async function createRunAction(fd: FormData) {
  await runAction("/payroll/new", (actor) => {
    const employerId = num(fd, "employer_id");
    const year = num(fd, "year"), month = num(fd, "month");
    const paymentDate = date(fd, "payment_date");
    if (!employerId || !year || !month || !paymentDate) throw new Error("יש למלא מעסיק, חודש, שנה ותאריך תשלום.");
    const employeeId = num(fd, "employee_id");
    const id = createRun(employerId, year, month, paymentDate, employeeId ? [employeeId] : undefined, actor);
    const entries = getDb().prepare("SELECT id FROM employee_payrolls WHERE run_id = ?").all(id) as { id: number }[];
    if (!entries.length) throw new Error("לא נמצאו עובדים פעילים לתקופה זו (או שכבר הופק להם תלוש לחודש זה).");
    return { to: entries.length === 1 ? `/payroll/${id}/${entries[0].id}` : `/payroll/${id}`, ok: "ההרצה נוצרה" };
  });
}

function readEntry(fd: FormData): RunEntryInput {
  const episodes = (str(fd, "sick_episodes") ?? "").split(/[,\s]+/).filter(Boolean).map((s) => {
    const [days, from] = s.split("+").map(Number);
    if (!Number.isFinite(days) || days <= 0) throw new Error("פורמט ימי מחלה: מספר ימים לכל רצף, מופרד בפסיק (למשל 3,2). המשך רצף מחודש קודם: 2+5");
    return { days, continuesFromDay: from || undefined };
  });
  const components: ExtraComponent[] = [];
  for (let i = 0; i < num0(fd, "c_count"); i++) {
    const type = str(fd, `c_type_${i}`);
    const amount = num(fd, `c_amount_${i}`), qty = num(fd, `c_qty_${i}`), rate = num(fd, `c_rate_${i}`);
    if (!type || !EXTRA_TYPES.includes(type as ExtraComponentType)) continue;
    if (amount === null && (qty === null || rate === null)) continue;
    components.push({ type: type as ExtraComponentType, description: str(fd, `c_desc_${i}`) ?? undefined, ...(amount !== null ? { amount } : { quantity: qty!, rate: rate! }) });
  }
  return {
    attendance: {
      workDays: num0(fd, "workDays"), regularHours: num(fd, "regularHours") ?? undefined,
      ot125: num0(fd, "ot125"), ot150: num0(fd, "ot150"), rest150: num0(fd, "rest150"), rest175: num0(fd, "rest175"), rest200: num0(fd, "rest200"),
      holiday150: num0(fd, "holiday150"), vacationDays: num0(fd, "vacationDays"), unpaidDays: num0(fd, "unpaidDays"), holidayPaidDays: num0(fd, "holidayPaidDays"),
      sickEpisodes: episodes,
    },
    components,
    recoveryDays: num(fd, "recoveryDays"),
    note: str(fd, "note") ?? undefined,
  };
}

export async function saveEntryAction(runId: number, entryId: number, fd: FormData) {
  await runAction(`/payroll/${runId}/${entryId}`, (actor) => {
    updateEntryInput(entryId, readEntry(fd), actor);
    const r = calculateEntry(entryId);
    getDb().prepare("UPDATE payroll_runs SET totals_json = ? WHERE id = ?").run(JSON.stringify(runTotals(runId)), runId);
    return { ok: r.ok ? "נשמר וחושב" : "נשמר – יש שגיאות שמונעות חישוב" };
  });
}

export async function calculateRunAction(runId: number) {
  await runAction(`/payroll/${runId}`, (actor) => {
    const t = calculateRun(runId, actor);
    return { ok: t.errors ? `חושב; ${t.errors} עובדים עם שגיאות` : "כל העובדים חושבו בהצלחה" };
  });
}

export async function approveRunAction(runId: number) {
  await runAction(`/payroll/${runId}`, (actor) => {
    approveRun(runId, actor);
    return { ok: "ההרצה אושרה: נוצרו תלושים ותשלומים" };
  });
}

export async function reverseRunAction(runId: number, fd: FormData) {
  await runAction(`/payroll/${runId}`, (actor) => {
    reverseRun(runId, str(fd, "reason") ?? "ללא סיבה", actor);
    return { ok: "ההרצה בוטלה. התלושים נשמרו בסטטוס 'בוטל'." };
  });
}

export async function deleteRunAction(runId: number) {
  await runAction(`/payroll/${runId}`, (actor) => {
    deleteDraftRun(runId, actor);
    return { to: "/payroll", ok: "טיוטת ההרצה נמחקה" };
  });
}

export async function recalcEntryAction(runId: number, entryId: number) {
  await runAction(`/payroll/${runId}/${entryId}`, () => {
    if (!getEntry(entryId)) throw new Error("לא נמצא");
    calculateEntry(entryId);
    getDb().prepare("UPDATE payroll_runs SET totals_json = ? WHERE id = ?").run(JSON.stringify(runTotals(runId)), runId);
    return { ok: "חושב מחדש" };
  });
}
