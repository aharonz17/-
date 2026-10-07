import crypto from "node:crypto";
import { getDb, json } from "./db";
import { audit } from "./audit";
import { parseUploadedFile } from "./import-file";
import { bankByCode, normalizeBankCode } from "@/domain/bank/banks";
import { categorize, type Category } from "@/domain/bank/categorize";
import { applyMapping, detectHeaderRow, guessMapping, normHeader, type DateFormat, type Grid, type Mapping } from "@/domain/bank/import";
import { buildStatement, sortTxns, type CanonicalTxn, type Direction } from "@/domain/bank/statement";
import { matchPayments, type MatchResult, type PaymentLike, type TxnLike } from "@/domain/matching/match";

const db = () => getDb();

export type BankAccount = {
  id: number; bank_code: string; bank_name: string | null; branch: string | null; account_number: string; holder: string;
  owner_type: "employer" | "employee" | "other"; owner_id: number | null; currency: string; opening_balance: number; opening_date: string | null;
  kind: "REAL" | "SIMULATED"; status: string; created_at: string;
};

export type BankTxnRow = {
  id: number; account_id: number; import_id: number | null; seq: number; transaction_date: string; value_date: string | null;
  amount: number; direction: Direction; balance_after: number | null; operation_type: string | null; reference: string | null;
  description: string; counterparty_name: string | null; counterparty_bank: string | null; counterparty_branch: string | null;
  counterparty_account: string | null; category: Category; source_format: string; raw_json: string | null; created_at: string;
};

// ───── חשבונות ─────
export const listAccounts = () => db().prepare(`SELECT a.*, (SELECT COUNT(*) FROM bank_transactions t WHERE t.account_id = a.id) txn_count
  FROM bank_accounts a ORDER BY a.kind, a.holder`).all() as (BankAccount & { txn_count: number })[];
export const getAccount = (id: number) => db().prepare("SELECT * FROM bank_accounts WHERE id = ?").get(id) as BankAccount | undefined;

export function createAccount(a: Omit<BankAccount, "id" | "created_at" | "status" | "bank_name"> & { bank_name?: string | null }, actor?: string) {
  const code = normalizeBankCode(a.bank_code);
  const id = Number(db().prepare(`INSERT INTO bank_accounts (bank_code, bank_name, branch, account_number, holder, owner_type, owner_id, currency, opening_balance, opening_date, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(code, a.bank_name ?? bankByCode(code)?.name ?? null, a.branch, a.account_number, a.holder,
    a.owner_type, a.owner_id, a.currency || "ILS", a.opening_balance || 0, a.opening_date, a.kind).lastInsertRowid);
  audit({ entityType: "bank_account", entityId: id, action: "CREATE", actor, newValue: { ...a, account_number: "***" } });
  return id;
}

export function updateAccountOpening(id: number, opening: number, openingDate: string | null, actor?: string) {
  const old = getAccount(id);
  db().prepare("UPDATE bank_accounts SET opening_balance = ?, opening_date = ? WHERE id = ?").run(opening, openingDate, id);
  audit({ entityType: "bank_account", entityId: id, action: "UPDATE_OPENING", actor, oldValue: { opening: old?.opening_balance, date: old?.opening_date }, newValue: { opening, date: openingDate } });
}

// ───── תנועות ─────
export function listTxns(accountId: number) {
  return sortTxns((db().prepare("SELECT * FROM bank_transactions WHERE account_id = ?").all(accountId) as BankTxnRow[]).map(toCanonical));
}

const toCanonical = (r: BankTxnRow): CanonicalTxn & { id: number; category: Category; source_format: string; seq: number } => ({
  id: r.id, seq: r.seq, transactionDate: r.transaction_date, valueDate: r.value_date, amount: r.amount, direction: r.direction,
  balanceAfter: r.balance_after, description: r.description, reference: r.reference, operationType: r.operation_type,
  counterpartyName: r.counterparty_name, counterpartyBank: r.counterparty_bank, counterpartyBranch: r.counterparty_branch,
  counterpartyAccount: r.counterparty_account, category: r.category, source_format: r.source_format,
});

/** דף חשבון לטווח תאריכים: יתרת הפתיחה לטווח = יתרת פתיחת החשבון + כל התנועות שלפני הטווח */
export function statementFor(accountId: number, from?: string | null, to?: string | null) {
  const acc = getAccount(accountId)!;
  const all = listTxns(accountId);
  let opening = acc.opening_balance;
  const before = from ? all.filter((t) => t.transactionDate < from) : [];
  for (const t of before) opening = Math.round((opening + (t.direction === "CREDIT" ? t.amount : -t.amount)) * 100) / 100;
  // אם יש יתרה מדווחת בשורה האחרונה שלפני הטווח – היא קובעת
  const lastReported = [...before].reverse().find((t) => t.balanceAfter !== null);
  if (lastReported && before[before.length - 1] === lastReported) opening = lastReported.balanceAfter!;
  const inRange = all.filter((t) => (!from || t.transactionDate >= from) && (!to || t.transactionDate <= to));
  return buildStatement(opening, inRange, { from, to });
}

export function addTxn(accountId: number, t: CanonicalTxn, source = "MANUAL", importId: number | null = null, actor?: string) {
  const seq = (db().prepare("SELECT COALESCE(MAX(seq), 0) + 1 s FROM bank_transactions WHERE account_id = ?").get(accountId) as { s: number }).s;
  const id = Number(db().prepare(`INSERT INTO bank_transactions (account_id, import_id, seq, transaction_date, value_date, amount, direction, balance_after,
    operation_type, reference, description, counterparty_name, counterparty_bank, counterparty_branch, counterparty_account, category, source_format, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(accountId, importId, seq, t.transactionDate, t.valueDate, t.amount, t.direction,
    t.balanceAfter, t.operationType ?? null, t.reference, t.description, t.counterpartyName ?? null, t.counterpartyBank ?? null,
    t.counterpartyBranch ?? null, t.counterpartyAccount ?? null, categorize(t.description, t.direction), source, t.raw ? JSON.stringify(t.raw) : null).lastInsertRowid);
  if (source === "MANUAL" || source === "SIMULATED") audit({ entityType: "bank_transaction", entityId: id, action: "CREATE", actor, newValue: t });
  return id;
}

export function deleteTxn(id: number, actor?: string) {
  const t = db().prepare("SELECT * FROM bank_transactions WHERE id = ?").get(id) as BankTxnRow | undefined;
  if (!t) return;
  const acc = getAccount(t.account_id)!;
  if (acc.kind === "REAL" && t.source_format !== "MANUAL") throw new Error("לא ניתן למחוק תנועה מיובאת מחשבון אמיתי. ניתן לבטל את כל הייבוא.");
  db().prepare("DELETE FROM bank_transactions WHERE id = ?").run(id);
  audit({ entityType: "bank_transaction", entityId: id, action: "DELETE", actor, oldValue: t });
}

export function setTxnCategory(id: number, category: Category, actor?: string) {
  db().prepare("UPDATE bank_transactions SET category = ? WHERE id = ?").run(category, id);
  audit({ entityType: "bank_transaction", entityId: id, action: "SET_CATEGORY", actor, newValue: category });
}

// ───── ייבוא ─────
export type ImportRow = { id: number; account_id: number; file_name: string; file_type: string; file_hash: string; header_row: number | null; mapping_json: string | null; date_format: string | null; rows_imported: number; issues_json: string; status: string; created_at: string };

export async function uploadImport(accountId: number, fileName: string, buf: Buffer, actor?: string) {
  const parsed = await parseUploadedFile(fileName, buf);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const dup = db().prepare("SELECT id FROM bank_imports WHERE account_id = ? AND file_hash = ? AND status = 'IMPORTED'").get(accountId, hash) as { id: number } | undefined;
  const headerRow = detectHeaderRow(parsed.grid);
  const signature = headerSignature(parsed.grid[headerRow] ?? []);
  const saved = db().prepare("SELECT mapping_json, date_format FROM import_mappings WHERE header_signature = ?").get(signature) as { mapping_json: string; date_format: DateFormat } | undefined;
  const mapping = saved ? json<Mapping>(saved.mapping_json, {}) : guessMapping(parsed.grid[headerRow] ?? []);
  const id = Number(db().prepare(`INSERT INTO bank_imports (account_id, file_name, file_type, file_hash, raw_blob, header_row, mapping_json, date_format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(accountId, fileName, parsed.fileType, hash, buf, headerRow, JSON.stringify(mapping), saved?.date_format ?? "auto").lastInsertRowid);
  audit({ entityType: "bank_import", entityId: id, action: "UPLOAD", actor, newValue: { fileName, fileType: parsed.fileType, encoding: parsed.encoding } });
  return { id, duplicateOf: dup?.id ?? null, usedSavedMapping: !!saved };
}

export const headerSignature = (row: Grid[number]) => row.map(normHeader).filter(Boolean).join("|");

export const getImport = (id: number) => db().prepare("SELECT * FROM bank_imports WHERE id = ?").get(id) as ImportRow | undefined;
export const listImports = (accountId: number) => db().prepare("SELECT id, account_id, file_name, file_type, rows_imported, status, created_at FROM bank_imports WHERE account_id = ? ORDER BY id DESC").all(accountId) as ImportRow[];

export async function importGrid(importId: number) {
  const imp = db().prepare("SELECT file_name, raw_blob FROM bank_imports WHERE id = ?").get(importId) as { file_name: string; raw_blob: Uint8Array };
  return (await parseUploadedFile(imp.file_name, Buffer.from(imp.raw_blob))).grid;
}

export async function previewImport(importId: number, headerRow: number, mapping: Mapping, fmt: DateFormat) {
  const grid = await importGrid(importId);
  const res = applyMapping(grid, headerRow, mapping, fmt);
  const opening = res.openingBalance;
  const st = buildStatement(opening ?? inferOpeningFromFirst(res.txns), res.txns);
  return { grid, ...res, statement: st };
}

function inferOpeningFromFirst(txns: CanonicalTxn[]) {
  const first = txns[0];
  if (!first || first.balanceAfter === null) return 0;
  return Math.round((first.balanceAfter - (first.direction === "CREDIT" ? first.amount : -first.amount)) * 100) / 100;
}

export async function commitImport(importId: number, headerRow: number, mapping: Mapping, fmt: DateFormat, opts: { saveMappingAs?: string; setOpening?: boolean }, actor?: string) {
  const imp = getImport(importId)!;
  if (imp.status === "IMPORTED") throw new Error("הקובץ כבר יובא.");
  const prev = await previewImport(importId, headerRow, mapping, fmt);
  if (prev.issues.some((i) => i.level === "ERROR" && i.row === 0)) throw new Error(prev.issues.find((i) => i.level === "ERROR")!.message);
  const acc = getAccount(imp.account_id)!;
  db().transaction(() => {
    for (const t of prev.txns) addTxn(acc.id, t, imp.file_type.toUpperCase(), importId);
    if (opts.setOpening) {
      const opening = prev.openingBalance ?? inferOpeningFromFirst(prev.txns);
      db().prepare("UPDATE bank_accounts SET opening_balance = ?, opening_date = ? WHERE id = ?").run(opening, prev.txns[0]?.transactionDate ?? null, acc.id);
    }
    db().prepare("UPDATE bank_imports SET header_row = ?, mapping_json = ?, date_format = ?, rows_imported = ?, issues_json = ?, status = 'IMPORTED' WHERE id = ?")
      .run(headerRow, JSON.stringify(mapping), fmt, prev.txns.length, JSON.stringify(prev.issues), importId);
    if (opts.saveMappingAs) {
      const sig = headerSignature(prev.grid[headerRow] ?? []);
      db().prepare(`INSERT INTO import_mappings (name, header_signature, mapping_json, date_format) VALUES (?, ?, ?, ?)
        ON CONFLICT(header_signature) DO UPDATE SET name = excluded.name, mapping_json = excluded.mapping_json, date_format = excluded.date_format`)
        .run(opts.saveMappingAs, sig, JSON.stringify(mapping), fmt);
    }
  })();
  audit({ entityType: "bank_import", entityId: importId, action: "IMPORT", actor, newValue: { rows: prev.txns.length, issues: prev.issues.length } });
  return prev.txns.length;
}

export function undoImport(importId: number, actor?: string) {
  const n = db().prepare("DELETE FROM bank_transactions WHERE import_id = ?").run(importId).changes;
  db().prepare("UPDATE bank_imports SET status = 'UNDONE', rows_imported = 0 WHERE id = ?").run(importId);
  audit({ entityType: "bank_import", entityId: importId, action: "UNDO", actor, newValue: { deleted: n } });
}

export const listSavedMappings = () => db().prepare("SELECT * FROM import_mappings ORDER BY name").all() as { id: number; name: string; header_signature: string; mapping_json: string; date_format: string }[];

// ───── חשבון סימולטיבי ─────
const SIM_TEMPLATES: Record<string, { desc: string; direction: Direction }> = {
  salary: { desc: "משכורת", direction: "CREDIT" },
  rent: { desc: "שכר דירה – הוראת קבע", direction: "DEBIT" },
  utilities: { desc: "חברת החשמל – הוראת קבע", direction: "DEBIT" },
  transfer_in: { desc: "העברה מחשבון אחר", direction: "CREDIT" },
  transfer_out: { desc: "העברה באינטרנט", direction: "DEBIT" },
  fee: { desc: "עמלת ערוץ ישיר", direction: "DEBIT" },
  card: { desc: "ישראכרט – חיוב חודשי", direction: "DEBIT" },
  deposit: { desc: "הפקדת מזומן", direction: "CREDIT" },
  withdrawal: { desc: "משיכת מזומן כספומט", direction: "DEBIT" },
};
export const SIM_TYPES = Object.entries(SIM_TEMPLATES).map(([k, v]) => ({ key: k, ...v }));

export function addSimulatedTxn(accountId: number, type: string, date: string, amount: number, description?: string, actor?: string) {
  const acc = getAccount(accountId)!;
  if (acc.kind !== "SIMULATED") throw new Error("ניתן להוסיף תנועות הדמיה רק לחשבון סימולטיבי.");
  const tpl = SIM_TEMPLATES[type] ?? { desc: description || "תנועה", direction: "DEBIT" as Direction };
  return addTxn(accountId, {
    transactionDate: date, valueDate: date, amount, direction: type === "custom_credit" ? "CREDIT" : type === "custom_debit" ? "DEBIT" : tpl.direction,
    balanceAfter: null, description: description || tpl.desc, reference: `SIM-${Date.now().toString(36).toUpperCase()}`,
  }, "SIMULATED", null, actor);
}

// ───── תשלומים והתאמות ─────
export type PaymentRow = {
  id: number; batch_id: number | null; run_id: number | null; payslip_id: number | null; employee_id: number | null; employer_id: number;
  beneficiary_name: string; beneficiary_id: string | null; bank_code: string | null; branch: string | null; account: string | null;
  amount: number; currency: string; reference: string | null; note: string | null; status: string; payment_date: string; year: number | null; month: number | null; created_at: string;
};

export function listPayments(filter: { batchId?: number; status?: string } = {}) {
  const w: string[] = [], a: unknown[] = [];
  if (filter.batchId) { w.push("p.batch_id = ?"); a.push(filter.batchId); }
  if (filter.status) { w.push("p.status = ?"); a.push(filter.status); }
  return db().prepare(`SELECT p.*, e.name employer_name, m.transaction_id, m.score match_score, m.status match_status
    FROM payments p JOIN employers e ON e.id = p.employer_id LEFT JOIN transaction_matches m ON m.payment_id = p.id
    ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY p.payment_date DESC, p.id DESC`).all(...a) as (PaymentRow & { employer_name: string; transaction_id: number | null; match_score: number | null; match_status: string | null })[];
}

export const listBatches = () => db().prepare(`SELECT b.*, e.name employer_name, r.year, r.month FROM payment_batches b JOIN employers e ON e.id = b.employer_id
  LEFT JOIN payroll_runs r ON r.id = b.run_id ORDER BY b.id DESC`).all() as { id: number; employer_id: number; run_id: number | null; payment_date: string; total_amount: number; payment_count: number; file_format: string; employer_name: string; year: number | null; month: number | null; created_at: string }[];

function candidateData() {
  const payments = db().prepare(`SELECT p.*, e.name employer_name FROM payments p JOIN employers e ON e.id = p.employer_id
    WHERE p.status IN ('PENDING','SENT') AND p.id NOT IN (SELECT payment_id FROM transaction_matches)`).all() as (PaymentRow & { employer_name: string })[];
  const txns = db().prepare(`SELECT t.*, a.bank_code acc_bank, a.branch acc_branch, a.account_number acc_number FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.account_id WHERE t.direction = 'CREDIT' AND t.id NOT IN (SELECT transaction_id FROM transaction_matches)`).all() as (BankTxnRow & { acc_bank: string; acc_branch: string; acc_number: string })[];
  const P: PaymentLike[] = payments.map((p) => ({
    id: p.id, amount: p.amount, paymentDate: p.payment_date, period: { year: p.year ?? 0, month: p.month ?? 0 },
    beneficiaryName: p.beneficiary_name, employerName: p.employer_name, reference: p.reference, bank: p.bank_code, branch: p.branch, account: p.account,
  }));
  const T: TxnLike[] = txns.map((t) => ({
    id: t.id, transactionDate: t.transaction_date, valueDate: t.value_date, amount: t.amount, direction: t.direction, description: t.description,
    reference: t.reference, counterpartyName: t.counterparty_name, accountBank: t.acc_bank, accountBranch: t.acc_branch, accountNumber: t.acc_number,
  }));
  return { P, T };
}

/** הצעות התאמה (לא נשמרות) */
export function suggestMatches(): MatchResult[] {
  const { P, T } = candidateData();
  return matchPayments(P, T);
}

export function confirmMatch(m: MatchResult, actor?: string) {
  db().transaction(() => {
    db().prepare("INSERT INTO transaction_matches (payment_id, transaction_id, score, status, reasons_json, confirmed) VALUES (?, ?, ?, ?, ?, 1)")
      .run(m.paymentId, m.txnId, m.score, m.status, JSON.stringify(m.reasons));
    db().prepare("UPDATE payments SET status = 'PAID' WHERE id = ?").run(m.paymentId);
    db().prepare("UPDATE bank_transactions SET category = 'SALARY' WHERE id = ?").run(m.txnId);
  })();
  audit({ entityType: "payment", entityId: m.paymentId, action: "MATCH", actor, newValue: m });
}

/** התאמה אוטומטית של כל ההתאמות הוודאיות */
export function autoMatch(actor?: string) {
  const sure = suggestMatches().filter((m) => m.status === "CONFIRMED");
  for (const m of sure) confirmMatch(m, actor);
  return sure.length;
}

export function unmatch(paymentId: number, actor?: string) {
  const m = db().prepare("SELECT * FROM transaction_matches WHERE payment_id = ?").get(paymentId);
  db().prepare("DELETE FROM transaction_matches WHERE payment_id = ?").run(paymentId);
  db().prepare("UPDATE payments SET status = 'PENDING' WHERE id = ? AND status = 'PAID'").run(paymentId);
  audit({ entityType: "payment", entityId: paymentId, action: "UNMATCH", actor, oldValue: m });
}

export function listMatches() {
  return db().prepare(`SELECT m.*, p.beneficiary_name, p.amount payment_amount, p.payment_date, p.reference payment_reference,
    t.transaction_date, t.description, t.amount txn_amount, t.account_id, a.holder account_holder, a.kind account_kind
    FROM transaction_matches m JOIN payments p ON p.id = m.payment_id JOIN bank_transactions t ON t.id = m.transaction_id
    JOIN bank_accounts a ON a.id = t.account_id ORDER BY m.id DESC`).all() as {
    id: number; payment_id: number; transaction_id: number; score: number; status: string; reasons_json: string; beneficiary_name: string; payment_amount: number;
    payment_date: string; payment_reference: string | null; transaction_date: string; description: string; txn_amount: number; account_id: number; account_holder: string; account_kind: string;
  }[];
}

/** רישום תשלום השכר בחשבון סימולטיבי של העובד (לבדיקות / הדגמה) */
export function postPaymentToSimulatedAccount(paymentId: number, accountId: number, actor?: string) {
  const p = db().prepare("SELECT p.*, e.name employer_name FROM payments p JOIN employers e ON e.id = p.employer_id WHERE p.id = ?").get(paymentId) as PaymentRow & { employer_name: string };
  const acc = getAccount(accountId)!;
  if (acc.kind !== "SIMULATED") throw new Error("רישום אוטומטי אפשרי רק בחשבון סימולטיבי. לחשבון אמיתי – ייבאו את דף החשבון מהבנק.");
  if (p.reference && db().prepare("SELECT 1 FROM bank_transactions WHERE account_id = ? AND reference = ?").get(accountId, p.reference))
    throw new Error("התשלום כבר נרשם בחשבון זה.");
  return addTxn(accountId, {
    transactionDate: p.payment_date, valueDate: p.payment_date, amount: p.amount, direction: "CREDIT", balanceAfter: null,
    description: `משכורת ${p.employer_name}`, reference: p.reference, counterpartyName: p.employer_name,
  }, "SIMULATED", null, actor);
}
