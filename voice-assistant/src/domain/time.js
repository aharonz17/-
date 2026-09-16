/**
 * כל חשבון הזמן של המערכת.
 *
 * אפיון, דרישה 17 וסעיף 27: הכול ב-Asia/Jerusalem, אף פעם לא ב-timezone
 * של השרת. Cloud Run רץ ב-UTC, ולכן הסתמכות על ברירת המחדל הייתה שוברת
 * כל תזכורת פעמיים בשנה במעבר שעון קיץ.
 *
 * אפיון, סעיף 9: "אין להסתמך על AI כדי להחליט לבד תאריך/שעה".
 * המודל מחזיר *מה שהוא שמע* ("+30m", "10:00"). החישוב עצמו קורה כאן,
 * בקוד דטרמיניסטי שאפשר לכתוב עליו בדיקות.
 */
import { DateTime } from 'luxon';
import { config } from '../config/index.js';

const ZONE = config.timezone;

/** כמה רחוק קדימה תזכורת עדיין נחשבת סבירה (סעיף 25: "תאריך לא הגיוני"). */
const MAX_FUTURE_DAYS = 365;

/** חלון חסד לתזכורת שנקבעה "עכשיו" ובזמן העיבוד כבר חלפה בשניות. */
const PAST_GRACE_SECONDS = 60;

export function now () {
    return DateTime.now().setZone(ZONE);
}

const HEBREW_MONTHS = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

const HEBREW_WEEKDAYS = [
    'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי',
    'יום שישי', 'יום שבת', 'יום ראשון'
];

/** luxon: weekday 1=שני ... 7=ראשון */
export function hebrewWeekday (dateTime) {
    return HEBREW_WEEKDAYS[dateTime.weekday - 1];
}

export function hebrewMonth (dateTime) {
    return HEBREW_MONTHS[dateTime.month - 1];
}

const RELATIVE_UNITS = { m: 'minutes', h: 'hours', d: 'days' };

/**
 * ממיר "+30m" לזמן מוחלט. מחזיר null על קלט שאינו תואם —
 * המקרה הזה כבר נחסם בסכימה, וההגנה כאן היא שכבה שנייה.
 */
export function applyRelative (relative, reference = now()) {
    const match = /^\+(\d{1,4})([mhd])$/.exec(relative || '');
    if (!match) return null;

    const amount = Number.parseInt(match[1], 10);
    const unit = RELATIVE_UNITS[match[2]];
    if (!unit) return null;

    return reference.plus({ [unit]: amount });
}

/**
 * "תזכיר לי בעשר" — בעברית מדוברת זה יכול להיות 10:00 או 22:00.
 *
 * ההכרעה: המופע הקרוב ביותר שעוד לא עבר. זו הכרעה ולא ניחוש —
 * התוצאה מוקראת למשתמש במפורש לפני שנוצרת תזכורת (דרישה 7),
 * כך שטעות נתפסת על ידו ולא מתגלה למחרת.
 */
export function resolveAmbiguousHour (time, reference = now()) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time || '');
    if (!match) return null;

    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);

    // דו-משמעות קיימת רק בשעות 1–12. "בשלוש עשרה" חד-משמעי.
    const candidates = hour >= 1 && hour <= 12
        ? [hour, hour + 12]
        : [hour];

    for (const candidateHour of candidates) {
        const candidate = reference.set({
            hour: candidateHour % 24, minute, second: 0, millisecond: 0
        });
        if (candidate > reference) return candidate;
    }

    // כל המועמדים היום כבר עברו — המופע הקרוב הוא מחר בשעה המוקדמת.
    return reference
        .plus({ days: 1 })
        .set({ hour: candidates[0], minute, second: 0, millisecond: 0 });
}

/**
 * מרכיב זמן מוחלט מהשדות שהמודל החזיר.
 *
 * מחזיר אחת משלוש תוצאות, ואף פעם לא ממציא מידע חסר (דרישה 8):
 *   { ok: true, at }                       — יש זמן ודאי
 *   { ok: false, reason: 'needs_time' }    — חסרה שעה, צריך לשאול
 *   { ok: false, reason: 'needs_date' }    — חסר יום, צריך לשאול
 *   { ok: false, reason: 'unreasonable' }  — הזמן לא הגיוני, לא יוצרים תזכורת
 */
export function resolveReminderTime (intent, reference = now()) {
    if (intent.relative) {
        const at = applyRelative(intent.relative, reference);
        if (!at) return { ok: false, reason: 'needs_time' };
        return validateReasonable(at, reference);
    }

    if (!intent.time) {
        return { ok: false, reason: 'needs_time' };
    }

    // שעה בלי תאריך: מותר רק כשהיא חד-משמעית מבחינת "המופע הקרוב".
    // אחרת שואלים "באיזה יום?" במקום להניח (סעיף 25).
    if (!intent.date) {
        if (intent.hour_ambiguous) {
            const at = resolveAmbiguousHour(intent.time, reference);
            if (!at) return { ok: false, reason: 'needs_time' };
            return validateReasonable(at, reference);
        }
        return { ok: false, reason: 'needs_date' };
    }

    const at = DateTime.fromISO(`${intent.date}T${intent.time}`, { zone: ZONE });
    if (!at.isValid) return { ok: false, reason: 'unreasonable' };

    return validateReasonable(at, reference);
}

function validateReasonable (at, reference) {
    if (at < reference.minus({ seconds: PAST_GRACE_SECONDS })) {
        return { ok: false, reason: 'unreasonable', detail: 'past' };
    }
    if (at > reference.plus({ days: MAX_FUTURE_DAYS })) {
        return { ok: false, reason: 'unreasonable', detail: 'too_far' };
    }
    return { ok: true, at };
}

/**
 * ניסוח הזמן להקראה בטלפון.
 *
 * מכוון להיות טבעי לאוזן ולא מדויק-מכונה: "מחר" עדיף על "17 בספטמבר"
 * כשמדובר במחר, אבל התאריך המלא נאמר גם כן כדי שהמשתמש יוכל לתפוס טעות יום.
 */
export function describeForSpeech (at, reference = now()) {
    const startOfToday = reference.startOf('day');
    const daysAhead = Math.round(at.startOf('day').diff(startOfToday, 'days').days);

    const clock = at.toFormat('HH:mm');
    const dayNumber = at.day;
    const monthName = hebrewMonth(at);

    if (daysAhead === 0) return `היום, ${dayNumber} ב${monthName}, בשעה ${clock}`;
    if (daysAhead === 1) return `מחר, ${dayNumber} ב${monthName}, בשעה ${clock}`;
    if (daysAhead === 2) return `מחרתיים, ${dayNumber} ב${monthName}, בשעה ${clock}`;
    if (daysAhead > 2 && daysAhead <= 7) {
        return `${hebrewWeekday(at)}, ${dayNumber} ב${monthName}, בשעה ${clock}`;
    }
    return `${hebrewWeekday(at)}, ${dayNumber} ב${monthName}, בשעה ${clock}`;
}

/** מפתח היום לכותרות ביומן ה-Docs ולקיבוץ. */
export function dayKey (dateTime) {
    return dateTime.toFormat('yyyy-MM-dd');
}

/** כותרת יום מלאה לעברית, ליומן ב-Google Docs. */
export function hebrewDayHeading (dateTime) {
    return `${hebrewWeekday(dateTime)}, ${dateTime.day} ב${hebrewMonth(dateTime)} ${dateTime.year}`;
}

/** חותמת זמן חד-משמעית לאחסון: ISO עם offset + שם ה-timezone לצידה (סעיף 27). */
export function toStorage (dateTime) {
    return { iso: dateTime.toISO(), zone: ZONE };
}

export function fromStorage (iso) {
    return DateTime.fromISO(iso, { zone: ZONE });
}

export { ZONE as TIMEZONE };
