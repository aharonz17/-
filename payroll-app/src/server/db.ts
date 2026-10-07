import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { RULES } from "@/rules-data";
import { ruleId } from "@/domain/rules/resolve";

// מסד נתונים עצמאי: קובץ SQLite יחיד (ברירת מחדל data/payroll.db).
// מיגרציות לפי PRAGMA user_version – כל שינוי סכמה = פונקציה חדשה ברשימה.

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);

  CREATE TABLE employers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, company_id TEXT, deductions_file TEXT, ni_file TEXT,
    address TEXT, city TEXT, phone TEXT, email TEXT, sector TEXT NOT NULL DEFAULT 'private',
    bank_code TEXT, branch TEXT, account TEXT, masav_institution_code TEXT, masav_sender_code TEXT,
    start_date TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE employees (
    id INTEGER PRIMARY KEY, employer_id INTEGER NOT NULL REFERENCES employers(id),
    employee_number TEXT, id_number TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    birth_date TEXT, gender TEXT NOT NULL DEFAULT 'male', marital_status TEXT,
    address TEXT, city TEXT, zip TEXT, phone TEXT, email TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
    bank_code TEXT, branch TEXT, account TEXT, account_holder TEXT, iban TEXT, payment_method TEXT NOT NULL DEFAULT 'BANK',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_employees_employer ON employees(employer_id);

  CREATE TABLE employments (
    id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL, end_date TEXT, role TEXT, department TEXT,
    job_percent REAL NOT NULL DEFAULT 100, pay_type TEXT NOT NULL DEFAULT 'monthly',
    base_salary REAL, hourly_rate REAL, daily_rate REAL, work_week_days INTEGER NOT NULL DEFAULT 5,
    standard_hours REAL, is_main_employer INTEGER NOT NULL DEFAULT 1, has_form_101 INTEGER NOT NULL DEFAULT 1,
    prior_seniority_months INTEGER NOT NULL DEFAULT 0,
    vacation_opening REAL NOT NULL DEFAULT 0, sick_opening REAL NOT NULL DEFAULT 0,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE tax_profiles (
    id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    tax_year INTEGER NOT NULL, facts_json TEXT NOT NULL DEFAULT '{}', settings_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(employee_id, tax_year)
  );

  CREATE TABLE rule_versions (
    id TEXT PRIMARY KEY, key TEXT NOT NULL, version TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
    payload_json TEXT NOT NULL, source_name TEXT NOT NULL, source_url TEXT, verified INTEGER NOT NULL DEFAULT 0,
    notes TEXT, origin TEXT NOT NULL DEFAULT 'seed', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE payroll_runs (
    id INTEGER PRIMARY KEY, employer_id INTEGER NOT NULL REFERENCES employers(id), year INTEGER NOT NULL, month INTEGER NOT NULL,
    payment_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', calculated_at TEXT, approved_at TEXT,
    totals_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE employee_payrolls (
    id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id), input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT, messages_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'DRAFT',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(run_id, employee_id)
  );

  CREATE TABLE payslips (
    id INTEGER PRIMARY KEY, employee_payroll_id INTEGER NOT NULL UNIQUE REFERENCES employee_payrolls(id),
    run_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, employer_id INTEGER NOT NULL,
    year INTEGER NOT NULL, month INTEGER NOT NULL, snapshot_json TEXT NOT NULL, hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'FINAL', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_payslips_employee ON payslips(employee_id, year, month);

  CREATE TABLE balance_entries (
    id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL, type TEXT NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL,
    opening REAL NOT NULL, accrued REAL NOT NULL, used REAL NOT NULL, adjustment REAL NOT NULL DEFAULT 0, closing REAL NOT NULL,
    payslip_id INTEGER, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_balance_employee ON balance_entries(employee_id, type, year, month);

  CREATE TABLE payment_batches (
    id INTEGER PRIMARY KEY, employer_id INTEGER NOT NULL, run_id INTEGER, payment_date TEXT NOT NULL,
    total_amount REAL NOT NULL, payment_count INTEGER NOT NULL, file_format TEXT NOT NULL DEFAULT 'MASAV',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY, batch_id INTEGER REFERENCES payment_batches(id), run_id INTEGER, payslip_id INTEGER,
    employee_id INTEGER, employer_id INTEGER NOT NULL, beneficiary_name TEXT NOT NULL, beneficiary_id TEXT,
    bank_code TEXT, branch TEXT, account TEXT, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'ILS',
    reference TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'PENDING', payment_date TEXT NOT NULL,
    year INTEGER, month INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE bank_accounts (
    id INTEGER PRIMARY KEY, bank_code TEXT NOT NULL, bank_name TEXT, branch TEXT, account_number TEXT NOT NULL,
    holder TEXT NOT NULL, owner_type TEXT NOT NULL DEFAULT 'other', owner_id INTEGER, currency TEXT NOT NULL DEFAULT 'ILS',
    opening_balance REAL NOT NULL DEFAULT 0, opening_date TEXT, kind TEXT NOT NULL DEFAULT 'REAL', status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE bank_imports (
    id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_hash TEXT NOT NULL, raw_blob BLOB NOT NULL,
    header_row INTEGER, mapping_json TEXT, date_format TEXT, rows_imported INTEGER NOT NULL DEFAULT 0,
    issues_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'UPLOADED', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE import_mappings (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, header_signature TEXT NOT NULL UNIQUE, mapping_json TEXT NOT NULL,
    date_format TEXT NOT NULL DEFAULT 'auto', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE bank_transactions (
    id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    import_id INTEGER REFERENCES bank_imports(id) ON DELETE SET NULL, seq INTEGER NOT NULL DEFAULT 0,
    transaction_date TEXT NOT NULL, value_date TEXT, amount REAL NOT NULL, direction TEXT NOT NULL,
    balance_after REAL, operation_type TEXT, reference TEXT, description TEXT NOT NULL DEFAULT '',
    counterparty_name TEXT, counterparty_bank TEXT, counterparty_branch TEXT, counterparty_account TEXT,
    category TEXT NOT NULL DEFAULT 'OTHER', source_format TEXT NOT NULL DEFAULT 'MANUAL', raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_txn_account ON bank_transactions(account_id, transaction_date, seq);

  CREATE TABLE transaction_matches (
    id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL UNIQUE REFERENCES bank_transactions(id) ON DELETE CASCADE,
    score INTEGER NOT NULL, status TEXT NOT NULL, reasons_json TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
    actor TEXT, old_value TEXT, new_value TEXT, source TEXT, reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id);
  `,
  `
  CREATE TABLE payslip_imports (
    id INTEGER PRIMARY KEY, file_name TEXT NOT NULL, file_hash TEXT NOT NULL, raw_blob BLOB NOT NULL,
    lines_json TEXT NOT NULL, extracted_json TEXT NOT NULL, scenario_json TEXT,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

/**
 * עטיפה דקה סביב node:sqlite (מובנה ב-Node 22.13+), כדי שלא יידרש רכיב שצריך קומפילציה ב-Windows.
 * מספקת את מה שהקוד צריך: prepare / exec / transaction / pragma.
 */
export class Db {
  private depth = 0;
  constructor(public raw: DatabaseSync) {}
  prepare(sql: string) {
    return new Stmt(this.raw.prepare(sql));
  }
  exec(sql: string) {
    this.raw.exec(sql);
  }
  pragma(p: string, opts: { simple?: boolean } = {}) {
    const rows = this.raw.prepare(`PRAGMA ${p}`).all() as Record<string, unknown>[];
    return opts.simple ? (rows[0] ? Object.values(rows[0])[0] : undefined) : rows;
  }
  /** כמו better-sqlite3: מחזירה פונקציה שמריצה את fn בטרנזקציה (תומך בקינון עם SAVEPOINT) */
  transaction<T>(fn: () => T): () => T {
    return () => {
      const sp = `sp${this.depth}`;
      this.raw.exec(this.depth === 0 ? "BEGIN" : `SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const r = fn();
        this.depth--;
        this.raw.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
        return r;
      } catch (e) {
        this.depth--;
        this.raw.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    };
  }
}

/** הצהרה מוכנה; הפרמטרים מועברים כמו שהם (מספרים, מחרוזות, null, Buffer) */
class Stmt {
  constructor(private s: StatementSync) {}
  run(...args: unknown[]) {
    return this.s.run(...(args as SQLInputValue[]));
  }
  get(...args: unknown[]): unknown {
    return this.s.get(...(args as SQLInputValue[]));
  }
  all(...args: unknown[]): unknown[] {
    return this.s.all(...(args as SQLInputValue[]));
  }
}

let _db: Db | null = null;

export function dbPath() {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "payroll.db");
}

export function getDb(): Db {
  if (_db) return _db;
  const p = dbPath();
  if (p !== ":memory:") fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new Db(new DatabaseSync(p));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  seedRules(db);
  _db = db;
  return db;
}

function migrate(db: Db) {
  const v = Number(db.pragma("user_version", { simple: true }) ?? 0);
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    })();
  }
}

/** טעינת כללי ה-seed (לא דורס כללים שנוספו ידנית מהממשק) */
function seedRules(db: Db) {
  const upsert = db.prepare(`INSERT INTO rule_versions (id, key, version, effective_from, effective_to, payload_json, source_name, source_url, verified, notes, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed')
    ON CONFLICT(id) DO UPDATE SET effective_from=excluded.effective_from, effective_to=excluded.effective_to, payload_json=excluded.payload_json,
      source_name=excluded.source_name, source_url=excluded.source_url, verified=excluded.verified, notes=excluded.notes
    WHERE rule_versions.origin = 'seed'`);
  db.transaction(() => {
    for (const r of RULES) {
      upsert.run(ruleId(r), r.key, r.version, r.effectiveFrom, r.effectiveTo, JSON.stringify(r.payload), r.source.name, r.source.url ?? null, r.verified ? 1 : 0, r.notes ?? null);
    }
  })();
}

export const json = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};
