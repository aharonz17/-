/**
 * טעינת הגדרות ואימות שלהן.
 *
 * שני עקרונות מהאפיון מיושמים כאן:
 *   - דרישה 15: אין סודות בקוד. הכול מגיע מסביבה.
 *   - דרישה 17: כל חישובי הזמן ב-Asia/Jerusalem, לא ב-timezone של השרת.
 *
 * ההגדרות נבדקות בעלייה ולא בשימוש הראשון, כדי ששגיאת הגדרה תיפול מיד
 * ולא באמצע שיחה אמיתית.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** טעינת .env בלי תלות חיצונית. משתני סביבה אמיתיים מנצחים תמיד. */
function loadDotEnv () {
    const envPath = resolve(projectRoot, '.env');
    if (!existsSync(envPath)) return;

    for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const eq = line.indexOf('=');
        if (eq === -1) continue;

        const key = line.slice(0, eq).trim();
        if (key in process.env) continue;

        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

loadDotEnv();

const missing = [];
const warnings = [];

function required (key, { hint } = {}) {
    const value = process.env[key];
    if (!value) {
        missing.push(hint ? `${key} — ${hint}` : key);
        return '';
    }
    return value;
}

function optional (key, fallback = '') {
    return process.env[key] || fallback;
}

function integer (key, fallback) {
    const raw = process.env[key];
    if (!raw) return fallback;

    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
        warnings.push(`${key}="${raw}" אינו מספר — נעשה שימוש בברירת המחדל ${fallback}`);
        return fallback;
    }
    return parsed;
}

function integerList (key, fallback) {
    const raw = process.env[key];
    if (!raw) return fallback;

    const parsed = raw.split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((n) => !Number.isNaN(n));

    if (parsed.length === 0) {
        warnings.push(`${key}="${raw}" לא הניב מספרים — נעשה שימוש בברירת המחדל`);
        return fallback;
    }
    return parsed;
}

/**
 * טוקן ימות הוא בפורמט <מספר-מערכת>:<סיסמה>.
 * בודקים את הצורה בעלייה כדי לא לגלות טעות הקלדה רק בשיחה הראשונה.
 */
function validateYemotToken (token) {
    if (!token) return;
    if (!/^\d{6,}:.+$/.test(token)) {
        warnings.push('YEMOT_TOKEN לא בפורמט הצפוי <מספר-מערכת>:<סיסמה> — קריאות ל-API של ימות עלולות להיכשל');
    }
}

/**
 * ימות דורשת ש-path של הקלטה יתחיל ב-/ ולא יסתיים ב-/.
 * האילוץ מתועד ב-RecordOptions של yemot-router2.
 */
function normalizeRecordingsPath (path) {
    let value = path || '/1';
    if (!value.startsWith('/')) value = `/${value}`;
    if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
    return value;
}

function normalizePhone (phone) {
    return (phone || '').replace(/[^\d]/g, '');
}

const transcriber = optional('ACTIVE_TRANSCRIBER', 'gemini');
if (!['gemini', 'google-stt'].includes(transcriber)) {
    warnings.push(`ACTIVE_TRANSCRIBER="${transcriber}" אינו מוכר — נעשה שימוש ב-gemini`);
}

const yemotToken = required('YEMOT_TOKEN', { hint: 'פורמט <מספר-מערכת>:<סיסמה>' });
validateYemotToken(yemotToken);

export const config = Object.freeze({
    env: optional('NODE_ENV', 'development'),
    isProduction: optional('NODE_ENV', 'development') === 'production',
    port: integer('PORT', 8080),
    logLevel: optional('LOG_LEVEL', 'info'),
    projectRoot,

    webhookSecret: required('WEBHOOK_SECRET', { hint: 'מגן על ה-webhook מפני שיחות מזויפות' }),

    yemot: Object.freeze({
        token: yemotToken,
        apiBase: 'https://www.call2all.co.il/ym/api',
        authorizedPhone: normalizePhone(required('AUTHORIZED_PHONE')),
        recordingsPath: normalizeRecordingsPath(optional('YEMOT_RECORDINGS_PATH', '/1')),
        callerId: optional('YEMOT_CALLER_ID')
    }),

    google: Object.freeze({
        projectId: optional('GOOGLE_PROJECT_ID'),
        credentialsPath: optional('GOOGLE_APPLICATION_CREDENTIALS'),
        geminiApiKey: optional('GEMINI_API_KEY'),
        geminiModel: optional('GEMINI_MODEL', 'gemini-2.5-flash'),
        driveFolderId: optional('GOOGLE_DRIVE_FOLDER_ID'),
        sheetId: optional('GOOGLE_SHEET_ID'),
        docsFolderId: optional('GOOGLE_DOCS_FOLDER_ID')
    }),

    timezone: optional('TIMEZONE', 'Asia/Jerusalem'),
    activeTranscriber: ['gemini', 'google-stt'].includes(transcriber) ? transcriber : 'gemini',

    recording: Object.freeze({
        maxSeconds: integer('MAX_RECORDING_SECONDS', 60),
        minSeconds: integer('MIN_RECORDING_SECONDS', 1)
    }),

    responseBudgetMs: integer('RESPONSE_BUDGET_MS', 3000),

    reminders: Object.freeze({
        // ברירת מחדל: חיוג אחד. תזכורת שלא אושרה לא הולכת לאיבוד —
        // היא עוברת ל-WAITING ומושמעת בשיחה הנכנסת הבאה.
        retryCount: integer('REMINDER_RETRY_COUNT', 1),
        retryDelaysMinutes: integerList('REMINDER_RETRY_DELAYS_MINUTES', [5, 15]),
        snoozeShortMinutes: integer('SNOOZE_SHORT_MINUTES', 10),
        snoozeLongMinutes: integer('SNOOZE_LONG_MINUTES', 60),
        // מכמה תזכורות ממתינות ואילך נשאל קודם אם לשמוע אותן,
        // במקום להשמיע ישר. תזכורת בודדת תמיד מושמעת ישר.
        inboxAskThreshold: integer('REMINDER_INBOX_ASK_THRESHOLD', 2)
    }),

    databasePath: resolve(projectRoot, optional('DATABASE_PATH', './data/assistant.sqlite'))
});

/**
 * מוחזר כרשימה ולא נזרק, כדי ש-bin/check-config.js יוכל להציג
 * את כל הבעיות בבת אחת במקום אחת-אחת.
 */
export function getConfigProblems () {
    return { missing: [...missing], warnings: [...warnings] };
}

export function assertConfigValid () {
    if (missing.length > 0) {
        throw new Error(
            `חסרות הגדרות חובה:\n  - ${missing.join('\n  - ')}\n\n` +
            'העתק את .env.example ל-.env ומלא את הערכים.'
        );
    }
}
