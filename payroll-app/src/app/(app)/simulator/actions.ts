"use server";
import { runAction } from "@/lib/action";
import { num, reqStr, str, validIsraeliId } from "@/lib/form";
import { deletePayslipImport, importPayslipPdf, saveScenarioAsEmployee } from "@/server/payslip-import";
import { normalizeBankCode } from "@/domain/bank/banks";
import type { Scenario } from "@/domain/payslip-import/scenario";

export async function uploadPayslipAction(fd: FormData) {
  await runAction("/simulator", async (actor) => {
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size) throw new Error("בחרו קובץ PDF של תלוש");
    const id = await importPayslipPdf(f.name, Buffer.from(await f.arrayBuffer()), actor);
    return { to: `/simulator/${id}`, ok: "התלוש נקרא. בדקו את הנתונים שזוהו." };
  });
}

export async function saveAsEmployeeAction(importId: number | null, fd: FormData) {
  await runAction(`/simulator/${importId ?? "new"}`, (actor) => {
    let scenario: Scenario;
    try { scenario = JSON.parse(reqStr(fd, "scenario", "תרחיש")); } catch { throw new Error("נתוני התרחיש לא תקינים"); }
    const idNumber = reqStr(fd, "id_number", "ת.ז").replace(/\D/g, "").padStart(9, "0");
    if (!validIsraeliId(idNumber)) throw new Error("מספר הזהות אינו תקין (ספרת ביקורת).");
    const id = saveScenarioAsEmployee({
      importId, scenario, employerId: num(fd, "employer_id"), employerName: str(fd, "employer_name") ?? "", employerCompanyId: str(fd, "employer_company_id"),
      deductionsFile: str(fd, "deductions_file"), firstName: reqStr(fd, "first_name", "שם פרטי"), lastName: reqStr(fd, "last_name", "שם משפחה"), idNumber,
      bankCode: str(fd, "bank_code") ? normalizeBankCode(str(fd, "bank_code")) : null, branch: str(fd, "branch"), account: str(fd, "account"),
      maritalStatus: str(fd, "marital_status"),
    }, actor);
    return { to: `/employees/${id}`, ok: "העובד נוצר מהתלוש" };
  });
}

export async function deleteImportAction(id: number) {
  await runAction("/simulator", (actor) => { deletePayslipImport(id, actor); return { ok: "נמחק" }; });
}
