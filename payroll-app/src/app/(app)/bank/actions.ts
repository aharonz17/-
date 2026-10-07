"use server";
import { runAction } from "@/lib/action";
import { date, num, reqStr, str } from "@/lib/form";
import {
  addSimulatedTxn, addTxn, commitImport, createAccount, deleteTxn, setTxnCategory, undoImport, updateAccountOpening, uploadImport,
} from "@/server/bank";
import { CANONICAL_FIELDS, type CanonicalField, type DateFormat, type Mapping } from "@/domain/bank/import";
import type { Category } from "@/domain/bank/categorize";

export async function createAccountAction(fd: FormData) {
  await runAction("/bank/new", (actor) => {
    const kind = str(fd, "kind") === "SIMULATED" ? "SIMULATED" : "REAL";
    const ownerType = (str(fd, "owner_type") ?? "other") as "employer" | "employee" | "other";
    const id = createAccount({
      bank_code: reqStr(fd, "bank_code", "בנק"), branch: str(fd, "branch"), account_number: reqStr(fd, "account_number", "מספר חשבון"),
      holder: reqStr(fd, "holder", "בעל החשבון"), owner_type: ownerType, owner_id: num(fd, `owner_id_${ownerType}`),
      currency: "ILS", opening_balance: num(fd, "opening_balance") ?? 0, opening_date: date(fd, "opening_date"), kind,
    }, actor);
    return { to: `/bank/${id}`, ok: "החשבון נוצר" };
  });
}

export async function addTxnAction(accountId: number, fd: FormData) {
  await runAction(`/bank/${accountId}`, (actor) => {
    const amount = num(fd, "amount");
    if (!amount || amount <= 0) throw new Error("סכום חייב להיות חיובי");
    const d = date(fd, "transaction_date");
    if (!d) throw new Error("חסר תאריך");
    addTxn(accountId, {
      transactionDate: d, valueDate: date(fd, "value_date") ?? d, amount, direction: str(fd, "direction") === "CREDIT" ? "CREDIT" : "DEBIT",
      balanceAfter: num(fd, "balance_after"), description: reqStr(fd, "description", "תיאור"), reference: str(fd, "reference"),
      counterpartyName: str(fd, "counterparty_name"),
    }, "MANUAL", null, actor);
    return { ok: "התנועה נוספה" };
  });
}

export async function addSimAction(accountId: number, fd: FormData) {
  await runAction(`/bank/${accountId}`, (actor) => {
    const amount = num(fd, "amount");
    if (!amount || amount <= 0) throw new Error("סכום חייב להיות חיובי");
    const d = date(fd, "date");
    if (!d) throw new Error("חסר תאריך");
    addSimulatedTxn(accountId, str(fd, "type") ?? "custom_debit", d, amount, str(fd, "description") ?? undefined, actor);
    return { ok: "תנועת הדמיה נוספה" };
  });
}

export async function deleteTxnAction(accountId: number, txnId: number) {
  await runAction(`/bank/${accountId}`, (actor) => { deleteTxn(txnId, actor); return { ok: "התנועה נמחקה" }; });
}

export async function setCategoryAction(accountId: number, txnId: number, fd: FormData) {
  await runAction(`/bank/${accountId}`, (actor) => { setTxnCategory(txnId, (str(fd, "category") ?? "OTHER") as Category, actor); });
}

export async function openingAction(accountId: number, fd: FormData) {
  await runAction(`/bank/${accountId}`, (actor) => {
    updateAccountOpening(accountId, num(fd, "opening_balance") ?? 0, date(fd, "opening_date"), actor);
    return { ok: "יתרת הפתיחה עודכנה" };
  });
}

export async function uploadAction(accountId: number, fd: FormData) {
  await runAction(`/bank/${accountId}/import`, async (actor) => {
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size) throw new Error("בחרו קובץ");
    const r = await uploadImport(accountId, f.name, Buffer.from(await f.arrayBuffer()), actor);
    const q = [`import=${r.id}`, r.duplicateOf ? `dup=${r.duplicateOf}` : "", r.usedSavedMapping ? "saved=1" : ""].filter(Boolean).join("&");
    return { to: `/bank/${accountId}/import?${q}` };
  });
}

function readMapping(fd: FormData): { headerRow: number; mapping: Mapping; fmt: DateFormat } {
  const mapping: Mapping = {};
  for (const k of Object.keys(CANONICAL_FIELDS) as CanonicalField[]) {
    const v = str(fd, `map_${k}`);
    if (v !== null && v !== "") mapping[k] = Number(v);
  }
  return { headerRow: Math.max(0, (num(fd, "header_row") ?? 1) - 1), mapping, fmt: (str(fd, "date_format") ?? "auto") as DateFormat };
}

export async function previewAction(accountId: number, importId: number, fd: FormData) {
  await runAction(`/bank/${accountId}/import?import=${importId}`, () => {
    const { headerRow, mapping, fmt } = readMapping(fd);
    const q = new URLSearchParams({ import: String(importId), h: String(headerRow), m: JSON.stringify(mapping), f: fmt, preview: "1" });
    return { to: `/bank/${accountId}/import?${q}` };
  });
}

export async function commitAction(accountId: number, importId: number, fd: FormData) {
  await runAction(`/bank/${accountId}/import?import=${importId}`, async (actor) => {
    const { headerRow, mapping, fmt } = readMapping(fd);
    const n = await commitImport(importId, headerRow, mapping, fmt, { saveMappingAs: str(fd, "save_as") ?? undefined, setOpening: fd.get("set_opening") === "on" }, actor);
    return { to: `/bank/${accountId}`, ok: `יובאו ${n} תנועות` };
  });
}

export async function undoImportAction(accountId: number, importId: number) {
  await runAction(`/bank/${accountId}`, (actor) => { undoImport(importId, actor); return { ok: "הייבוא בוטל והתנועות שלו נמחקו" }; });
}
