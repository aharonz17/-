/**
 * גישה לנתונים. כל השאילתות במקום אחד.
 *
 * העיקרון שחוזר כאן: כל כתיבה שעלולה להגיע פעמיים היא idempotent
 * (דרישה 19). INSERT ... ON CONFLICT DO NOTHING + SELECT חוזר, במקום
 * "בדוק ואז הכנס" שנשבר בתנאי מרוץ.
 */
import { randomUUID } from 'node:crypto';
import { getDb, STATUS } from './db.js';
import { now, toStorage } from '../domain/time.js';

const timestamp = () => now().toISO();

/**
 * רישום הקלטה. נקרא *מיד* כשימות מוסרת את נתיב הקובץ, לפני כל עיבוד.
 * קריאה שנייה עם אותו (call_id, yemot_path) מחזירה את הרשומה הקיימת
 * ולא יוצרת כפילות.
 *
 * @returns {{recording: object, created: boolean}}
 */
export function recordRecording ({ callId, phone, yemotPath }) {
    const db = getDb();

    const insert = db.prepare(`
        INSERT INTO recordings (recording_id, call_id, phone, yemot_path, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (call_id, yemot_path) DO NOTHING
    `);

    const recordingId = randomUUID();
    const result = insert.run(recordingId, callId, phone, yemotPath, timestamp());

    const recording = db
        .prepare('SELECT * FROM recordings WHERE call_id = ? AND yemot_path = ?')
        .get(callId, yemotPath);

    return { recording, created: result.changes > 0 };
}

export function attachRecordingArtifacts (recordingId, { localPath, bytes, driveFileId, driveLink }) {
    getDb().prepare(`
        UPDATE recordings
        SET local_path    = COALESCE(?, local_path),
            bytes         = COALESCE(?, bytes),
            drive_file_id = COALESCE(?, drive_file_id),
            drive_link    = COALESCE(?, drive_link)
        WHERE recording_id = ?
    `).run(localPath ?? null, bytes ?? null, driveFileId ?? null, driveLink ?? null, recordingId);
}

export function getRecording (recordingId) {
    return getDb().prepare('SELECT * FROM recordings WHERE recording_id = ?').get(recordingId);
}

/**
 * שמירת מה שהובן. parsed_intent נשמר כ-JSON מלא לצד השדות המפוענחים,
 * כדי שתמיד אפשר יהיה לחזור ולראות בדיוק מה המודל החזיר (דרישה 9).
 */
export function saveEntry ({ recordingId, callId, type, transcript, intent, text, status, confidence, engine }) {
    const db = getDb();
    const entryId = randomUUID();

    const result = db.prepare(`
        INSERT INTO entries (
            entry_id, recording_id, call_id, type, transcript,
            parsed_intent, text, status, confidence, engine, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (recording_id) DO NOTHING
    `).run(
        entryId, recordingId, callId, type, transcript ?? null,
        intent ? JSON.stringify(intent) : null, text ?? null,
        status, confidence ?? null, engine ?? null, timestamp()
    );

    const entry = db.prepare('SELECT * FROM entries WHERE recording_id = ?').get(recordingId);
    return { entry, created: result.changes > 0 };
}

export function markEntryConfirmed (entryId) {
    getDb().prepare(`
        UPDATE entries SET status = ?, confirmed_at = ? WHERE entry_id = ?
    `).run(STATUS.CONFIRMED, timestamp(), entryId);
}

export function markEntryCancelled (entryId) {
    getDb().prepare('UPDATE entries SET status = ? WHERE entry_id = ?')
        .run(STATUS.CANCELLED, entryId);
}

export function getEntry (entryId) {
    return getDb().prepare('SELECT * FROM entries WHERE entry_id = ?').get(entryId);
}

/**
 * יצירת תזכורת. נקראת רק אחרי אישור מפורש של המשתמש (דרישה 7).
 * @param {import('luxon').DateTime} dueAt
 */
export function createReminder ({ entryId, callId, text, dueAt }) {
    const db = getDb();
    const reminderId = randomUUID();
    const stored = toStorage(dueAt);

    db.prepare(`
        INSERT INTO reminders (
            reminder_id, entry_id, call_id, text, due_at, timezone, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reminderId, entryId, callId, text, stored.iso, stored.zone, STATUS.CONFIRMED, timestamp());

    return db.prepare('SELECT * FROM reminders WHERE reminder_id = ?').get(reminderId);
}

export function getReminder (reminderId) {
    return getDb().prepare('SELECT * FROM reminders WHERE reminder_id = ?').get(reminderId);
}

/**
 * תזכורות שהגיע זמנן ועדיין לא טופלו.
 *
 * זו גם רשת הביטחון של דרישה 18: תזכורת שהשרת פספס בזמן השבתה נשלפת
 * כאן ברגע שהוא חוזר, במקום להיעלם בשקט.
 */
export function findDueReminders (asOf = now()) {
    return getDb().prepare(`
        SELECT * FROM reminders
        WHERE status IN (?, ?) AND due_at <= ?
        ORDER BY due_at ASC
    `).all(STATUS.CONFIRMED, STATUS.SNOOZED, asOf.toISO());
}

export function markReminderCalled (reminderId) {
    getDb().prepare(`
        UPDATE reminders
        SET attempts = attempts + 1, last_called_at = ?
        WHERE reminder_id = ?
    `).run(timestamp(), reminderId);
}

export function markReminderCompleted (reminderId) {
    getDb().prepare(`
        UPDATE reminders SET status = ?, completed_at = ? WHERE reminder_id = ?
    `).run(STATUS.COMPLETED, timestamp(), reminderId);
}

/**
 * דחיית תזכורת.
 *
 * attempts מתאפס בכוונה: המשתמש ביקש במפורש שיזכירו לו שוב, ולכן זו
 * תזכורת חדשה לעניין מכסת הניסיונות. בלי האיפוס, דחייה מתוך תיבת
 * ההמתנה הייתה נחשבת כמיצוי המכסה וחוזרת מיד ל-WAITING בלי לחייג.
 */
export function snoozeReminder (reminderId, until) {
    const stored = toStorage(until);
    getDb().prepare(`
        UPDATE reminders
        SET status = ?, due_at = ?, snoozed_to = ?, attempts = 0
        WHERE reminder_id = ?
    `).run(STATUS.SNOOZED, stored.iso, stored.iso, reminderId);
}

/**
 * תזמון מחדש של ניסיון חוזר ביוזמת המערכת.
 *
 * בניגוד ל-snoozeReminder, כאן attempts *נשמר* — זה אותו ניסיון להשיג
 * את המשתמש, לא בקשה חדשה שלו. שתי הפעולות נראות דומות ולכן מופרדות
 * במפורש: ערבוב ביניהן יוצר לולאת חיוג אינסופית.
 */
export function rescheduleReminderForRetry (reminderId, at) {
    const stored = toStorage(at);
    getDb().prepare(`
        UPDATE reminders SET status = ?, due_at = ? WHERE reminder_id = ?
    `).run(STATUS.SNOOZED, stored.iso, reminderId);
}

/**
 * תזכורת שחויגה ולא אושרה. היא לא נמחקת ולא נסגרת — היא עוברת לתיבת
 * ההמתנה ותושמע בשיחה הנכנסת הבאה.
 */
export function markReminderWaiting (reminderId) {
    getDb().prepare('UPDATE reminders SET status = ? WHERE reminder_id = ?')
        .run(STATUS.WAITING, reminderId);
}

/**
 * התזכורות הממתינות, מהוותיקה לחדשה.
 *
 * ה-JOIN מביא את נתיב ההקלטה המקורית באותה שאילתה, כדי שהשמעה חוזרת
 * (הקשה 9) לא תדרוש שאילתה נוספת לכל תזכורת בתוך שיחה פעילה.
 */
export function findWaitingReminders ({ limit = 20 } = {}) {
    return getDb().prepare(`
        SELECT r.*, rec.yemot_path, rec.drive_link
        FROM reminders r
        JOIN entries    e   ON e.entry_id      = r.entry_id
        JOIN recordings rec ON rec.recording_id = e.recording_id
        WHERE r.status = ?
        ORDER BY r.due_at ASC
        LIMIT ?
    `).all(STATUS.WAITING, limit);
}

export function markReminderNoAnswer (reminderId) {
    getDb().prepare('UPDATE reminders SET status = ? WHERE reminder_id = ?')
        .run(STATUS.NO_ANSWER, reminderId);
}

/**
 * הוספת משימת כתיבה לשכבת תצוגה.
 * idempotencyKey מונע שכפול שורה ב-Docs או ב-Sheet כשהתור מעובד פעמיים.
 */
export function enqueueMirrorWrite ({ target, payload, idempotencyKey }) {
    const result = getDb().prepare(`
        INSERT INTO mirror_queue (target, payload, idempotency_key, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (target, idempotency_key) DO NOTHING
    `).run(target, JSON.stringify(payload), idempotencyKey, timestamp());

    return result.changes > 0;
}

export function claimPendingMirrorWrites ({ limit = 20, maxAttempts = 6 } = {}) {
    return getDb().prepare(`
        SELECT * FROM mirror_queue
        WHERE completed_at IS NULL AND attempts < ?
        ORDER BY queue_id ASC
        LIMIT ?
    `).all(maxAttempts, limit);
}

export function markMirrorWriteCompleted (queueId) {
    getDb().prepare('UPDATE mirror_queue SET completed_at = ? WHERE queue_id = ?')
        .run(timestamp(), queueId);
}

export function markMirrorWriteFailed (queueId, error) {
    getDb().prepare(`
        UPDATE mirror_queue SET attempts = attempts + 1, last_error = ? WHERE queue_id = ?
    `).run(String(error).slice(0, 500), queueId);
}

/**
 * שרשרת המעקב המלאה של דרישה 23:
 * Reminder -> Entry -> Recording -> Audio -> Transcript -> Intent -> Confirmation.
 */
export function traceReminder (reminderId) {
    const db = getDb();
    const reminder = db.prepare('SELECT * FROM reminders WHERE reminder_id = ?').get(reminderId);
    if (!reminder) return null;

    const entry = db.prepare('SELECT * FROM entries WHERE entry_id = ?').get(reminder.entry_id);
    const recording = entry
        ? db.prepare('SELECT * FROM recordings WHERE recording_id = ?').get(entry.recording_id)
        : null;

    return { reminder, entry, recording };
}

export { STATUS };
