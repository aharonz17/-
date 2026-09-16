/**
 * SQLite — מקור האמת של המערכת.
 *
 * למה לא Google Sheets כמסד הנתונים (אפיון, סעיף 11 מתיר "Sheets או DB קטן"):
 * דרישה 19 מחייבת idempotency — "אם Webhook התקבל פעמיים, אסור ליצור שתי
 * תזכורות זהות". ל-Sheets אין טרנזקציות ואין אילוץ ייחודיות, ולכן אי אפשר
 * לאכוף שם את הדרישה הזו בצורה אמינה. ב-SQLite זה אילוץ UNIQUE שעולה שורה אחת.
 * ה-Sheet נשאר כמראה לתצוגה, לא כמקור אמת.
 *
 * דרישה 13: call_id / recording_id / reminder_id נשמרים ומקושרים, כדי שאפשר
 * יהיה לעקוב אחרי פעולה מתחילתה ועד סופה (דרישה 23).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config/index.js';

export const STATUS = Object.freeze({
    PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
    CONFIRMED: 'CONFIRMED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    SNOOZED: 'SNOOZED',
    NO_ANSWER: 'NO_ANSWER',
    ERROR: 'ERROR'
});

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- כל הקלטה שהגיעה למערכת. נכתבת לפני כל עיבוד (דרישה 6 ודרישה 12):
-- גם אם התמלול, ה-AI או Drive נכשלו, השורה הזו כבר קיימת והאודיו לא אבד.
CREATE TABLE IF NOT EXISTS recordings (
    recording_id    TEXT PRIMARY KEY,
    call_id         TEXT NOT NULL,
    phone           TEXT NOT NULL,
    yemot_path      TEXT NOT NULL,
    local_path      TEXT,
    drive_file_id   TEXT,
    drive_link      TEXT,
    bytes           INTEGER,
    created_at      TEXT NOT NULL,
    -- מונע כפילות כשימות שולחת את אותה בקשה פעמיים (דרישה 19)
    UNIQUE (call_id, yemot_path)
);

-- הפרדה מוחלטת בין השלבים (דרישה 9): התמלול הגולמי, הכוונה שהובנה,
-- והפעולה שבוצעה בפועל — כל אחד בעמודה משלו, אף אחד לא דורס את השני.
CREATE TABLE IF NOT EXISTS entries (
    entry_id        TEXT PRIMARY KEY,
    recording_id    TEXT NOT NULL REFERENCES recordings(recording_id),
    call_id         TEXT NOT NULL,
    type            TEXT NOT NULL,
    transcript      TEXT,
    parsed_intent   TEXT,
    text            TEXT,
    status          TEXT NOT NULL,
    confidence      REAL,
    engine          TEXT,
    created_at      TEXT NOT NULL,
    confirmed_at    TEXT,
    UNIQUE (recording_id)
);

CREATE TABLE IF NOT EXISTS reminders (
    reminder_id     TEXT PRIMARY KEY,
    entry_id        TEXT NOT NULL REFERENCES entries(entry_id),
    call_id         TEXT NOT NULL,
    text            TEXT NOT NULL,
    due_at          TEXT NOT NULL,
    timezone        TEXT NOT NULL,
    status          TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    last_called_at  TEXT,
    completed_at    TEXT,
    snoozed_to      TEXT,
    cancelled_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_reminders_due
    ON reminders (status, due_at);

-- תור הכתיבה לשכבות התצוגה (Drive / Sheets / Docs).
-- נפרד מהמסלול החי בכוונה: אם Docs איטי או נופל, זה לא מעכב שיחה
-- ולא מאבד רשומה — היא כבר שמורה בטבלאות שלמעלה.
CREATE TABLE IF NOT EXISTS mirror_queue (
    queue_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    target          TEXT NOT NULL,
    payload         TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TEXT NOT NULL,
    completed_at    TEXT,
    UNIQUE (target, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_mirror_pending
    ON mirror_queue (completed_at, attempts);
`;

let instance = null;

export function getDb () {
    if (instance) return instance;

    mkdirSync(dirname(config.databasePath), { recursive: true });
    instance = new Database(config.databasePath);
    instance.exec(SCHEMA);
    return instance;
}

export function closeDb () {
    if (instance) {
        instance.close();
        instance = null;
    }
}
