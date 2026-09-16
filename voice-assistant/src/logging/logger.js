/**
 * לוגר מובנה.
 *
 * אפיון, דרישה 14: כל שגיאה צריכה לכלול מספיק מידע לאיתור תקלה,
 * ואין לשמור Secrets בתוך Logs. הסינון כאן הוא ברירת מחדל ולא אופציה —
 * redact רץ על כל רשומה, גם כשהקורא לא חשב על זה.
 *
 * אפיון, דרישה 13: call_id / recording_id / reminder_id נישאים לאורך כל
 * הזרימה. logger.child({ callId }) מייצר לוגר שמצרף אותם אוטומטית לכל שורה.
 */
import { config } from '../config/index.js';
import { assertKnownEvent } from './events.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const activeLevel = LEVELS[config.logLevel] ?? LEVELS.info;

/** שמות שדות שערכם לא נכתב ללוג לעולם. */
const SECRET_KEYS = [
    'token', 'password', 'secret', 'apikey', 'api_key', 'authorization',
    'credentials', 'private_key', 'privatekey', 'webhooksecret', 'access_token'
];

function isSecretKey (key) {
    const lower = key.toLowerCase();
    return SECRET_KEYS.some((needle) => lower.includes(needle));
}

/**
 * הטוקן של ימות מופיע בתוך URL-ים שלמים (?token=0773123456:1234),
 * ולכן לא מספיק לסנן לפי שם שדה — צריך גם לנקות מחרוזות.
 */
function redactString (value) {
    return value
        .replace(/([?&](?:token|key|secret|api_key|apiKey)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/\b\d{6,}:[^\s&"']+/g, '[REDACTED_TOKEN]');
}

function redact (value, depth = 0) {
    if (depth > 6) return '[TOO_DEEP]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value !== 'object') return value;
    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactString(value.message),
            stack: value.stack ? redactString(value.stack) : undefined,
            ...(value.code ? { code: value.code } : {})
        };
    }
    if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

    const output = {};
    for (const [key, item] of Object.entries(value)) {
        output[key] = isSecretKey(key) ? '[REDACTED]' : redact(item, depth + 1);
    }
    return output;
}

function write (level, context, event, details) {
    if (LEVELS[level] < activeLevel) return;
    if (event) assertKnownEvent(event);

    const record = {
        ts: new Date().toISOString(),
        level,
        ...(event ? { event } : {}),
        ...context,
        ...redact(details || {})
    };

    const line = JSON.stringify(record);
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
}

function build (context) {
    return {
        /** רישום אירוע מאוצר המילים של האפיון. */
        event (event, details) {
            write('info', context, event, details);
        },
        /** אירוע שגיאה. תמיד נרשם עם event=ERROR כדי שיהיה ניתן לסינון אחיד. */
        failure (details) {
            write('error', context, 'ERROR', details);
        },
        debug (message, details) {
            write('debug', context, null, { message, ...details });
        },
        info (message, details) {
            write('info', context, null, { message, ...details });
        },
        warn (message, details) {
            write('warn', context, null, { message, ...details });
        },
        error (message, details) {
            write('error', context, null, { message, ...details });
        },
        /** לוגר חדש שנושא את מזהי המעקב של דרישה 13. */
        child (extra) {
            return build({ ...context, ...extra });
        }
    };
}

export const logger = build({});
export { redact as redactForTest };
