"use server";
import { runAction } from "@/lib/action";
import { reqStr, str, date } from "@/lib/form";
import { saveEmployer, getEmployer } from "@/server/repo";
import { audit } from "@/server/audit";
import { normalizeBankCode } from "@/domain/bank/banks";

function read(fd: FormData) {
  return {
    name: reqStr(fd, "name", "שם המעסיק"),
    company_id: str(fd, "company_id"),
    deductions_file: str(fd, "deductions_file"),
    ni_file: str(fd, "ni_file"),
    address: str(fd, "address"),
    city: str(fd, "city"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    sector: (str(fd, "sector") === "public" ? "public" : "private") as "public" | "private",
    bank_code: str(fd, "bank_code") ? normalizeBankCode(str(fd, "bank_code")) : null,
    branch: str(fd, "branch"),
    account: str(fd, "account"),
    masav_institution_code: str(fd, "masav_institution_code"),
    masav_sender_code: str(fd, "masav_sender_code"),
    start_date: date(fd, "start_date"),
    status: str(fd, "status") ?? "ACTIVE",
  };
}

export async function createEmployerAction(fd: FormData) {
  await runAction("/employers/new", (actor) => {
    const data = read(fd);
    const id = saveEmployer(data);
    audit({ entityType: "employer", entityId: id, action: "CREATE", actor, newValue: data });
    return { to: `/employers/${id}`, ok: "המעסיק נוצר" };
  });
}

export async function updateEmployerAction(id: number, fd: FormData) {
  await runAction(`/employers/${id}`, (actor) => {
    const old = getEmployer(id);
    const data = read(fd);
    saveEmployer(data, id);
    audit({ entityType: "employer", entityId: id, action: "UPDATE", actor, oldValue: old, newValue: data });
    return { ok: "נשמר" };
  });
}
