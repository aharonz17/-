/**
 * ניסוח משפט האישור שמוקרא למשתמש.
 *
 * זה המודול שמממש את דרישה 7 באפיון ("כל פעולה משמעותית דורשת אישור"),
 * ואת הכלל שהוספנו מעליה:
 *
 *   >> משפט האישור לא מגיע מהמודל. <<
 *
 * המודל מנסח רק את שדה reply, שהוא שיחה חופשית. המשפט שמתאר *מה עומד
 * להישמר* נבנה כאן, מתוך שדות שכבר עברו validation וחישוב זמן דטרמיניסטי.
 * בלי ההפרדה הזו, מודל שהוזה יכול להקריא "קבעתי לך תזכורת" בזמן שה-validation
 * נכשל ושום דבר לא נשמר — והמשתמש ילך מהטלפון בטוח שיש לו תזכורת.
 */
import { describeForSpeech } from './time.js';
import { sanitizeForSpeech } from './speech.js';

/** מה מוקרא אחרי משפט האישור, בכל מסלול. */
export const CONFIRM_MENU = 'לאישור הקש 1, להקלטה מחדש הקש 2';

/**
 * משפט אישור לתזכורת.
 * @param {string} text מה להזכיר
 * @param {import('luxon').DateTime} at מתי, אחרי חישוב ב-Asia/Jerusalem
 */
export function confirmReminder (text, at, reference) {
    const when = describeForSpeech(at, reference);
    const what = sanitizeForSpeech(text);
    return `הבנתי: ${when}, להזכיר לך ${what}`;
}

/** משפט אישור לפתק. */
export function confirmNote (text) {
    return `הבנתי, פתק: ${sanitizeForSpeech(text)}`;
}

/**
 * ניסוח שאלת הבהרה כשחסר מידע קריטי (דרישה 8: אין לנחש מידע חסר).
 * @param {'needs_time'|'needs_date'|'unreasonable'|'unclear'} reason
 */
export function askForMissing (reason, detail) {
    switch (reason) {
        case 'needs_time':
            return 'באיזו שעה להזכיר לך?';
        case 'needs_date':
            return 'באיזה יום להזכיר לך?';
        case 'unreasonable':
            return detail === 'past'
                ? 'הזמן שאמרת כבר עבר, מתי להזכיר לך?'
                : 'הזמן שאמרת נשמע רחוק מדי, מתי להזכיר לך?';
        default:
            return 'לא הצלחתי להבין, אפשר לחזור על זה?';
    }
}

/** הודעת הפתיחה של השיחה החוזרת בזמן התזכורת (סעיף 14 באפיון). */
export function reminderCallScript (text, snoozeShortMinutes, snoozeLongMinutes) {
    const what = sanitizeForSpeech(text);
    const longLabel = snoozeLongMinutes === 60
        ? 'לעוד שעה'
        : `לעוד ${snoozeLongMinutes} דקות`;

    return {
        body: `תזכורת: ${what}`,
        menu: `אם ביצעת הקש 1, לעוד ${snoozeShortMinutes} דקות הקש 2, ${longLabel} הקש 3`
    };
}

/**
 * הטקסט של תזכורת ממתינה, כפי שהיא מושמעת בתיבה בתחילת שיחה נכנסת.
 *
 * @param {string} text מה להזכיר
 * @param {string} ageText "מאתמול" וכדומה
 * @param {boolean} allowReplay האם להציע השמעה של ההקלטה המקורית
 */
export function pendingReminderScript (text, ageText, { snoozeShortMinutes, snoozeLongMinutes, allowReplay }) {
    const longLabel = snoozeLongMinutes === 60
        ? 'לעוד שעה'
        : `לעוד ${snoozeLongMinutes} דקות`;

    const options = [
        'אם ביצעת הקש 1',
        `לעוד ${snoozeShortMinutes} דקות הקש 2`,
        `${longLabel} הקש 3`
    ];

    if (allowReplay) {
        options.push('לשמוע את ההקלטה המקורית הקש 9');
    }

    return {
        body: `תזכורת ${ageText}: ${sanitizeForSpeech(text)}`,
        menu: options.join(', ')
    };
}

/** ההודעה שנשמעת כשממתינות כמה תזכורות, לפני שמשמיעים אותן. */
export function inboxOfferScript (count) {
    return `יש לך ${count} תזכורות שממתינות, לשמוע אותן הקש 1, לדלג הקש 2`;
}
