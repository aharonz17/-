/**
 * הכנת טקסט להקראה במנוע ה-TTS של ימות.
 *
 * ימות פוסלת את התווים  . - " ' & |  בהקראת טקסט. אומת מול המימוש של
 * yemot-router2 (lib/response-functions.js, invalidCharsRgx) — הספרייה
 * זורקת CallError על טקסט שמכיל אותם.
 *
 * הניקוי כאן *מחליף* ולא *מוחק*, בכוונה: removeInvalidChars של הספרייה
 * מוחקת, וכך "10-30" הופך ל-"1030" והמשתמש שומע "אלף שלושים".
 * החלפה ברווח שומרת על המשמעות בהקראה.
 */

const REPLACEMENTS = [
    [/&/g, ' ו'],
    [/[."'|]/g, ' '],
    [/-/g, ' ']
];

export function sanitizeForSpeech (text) {
    let output = String(text ?? '');
    for (const [pattern, replacement] of REPLACEMENTS) {
        output = output.replace(pattern, replacement);
    }
    return output.replace(/\s+/g, ' ').trim();
}

/** בניית הודעת TTS יחידה עבור yemot-router2. */
export function say (text) {
    return { type: 'text', data: sanitizeForSpeech(text), removeInvalidChars: true };
}

/** בניית רצף הודעות מתוך מחרוזות. */
export function sayAll (...texts) {
    return texts.filter(Boolean).map((text) => say(text));
}

/**
 * הודעה שמשמיעה קובץ שמור במערכת ימות — משמש להשמעה חוזרת של ההקלטה
 * המקורית של המשתמש.
 *
 * למה זה לא סתם `{ type: 'file', data: path }`:
 *
 * ב-makeMessagesData של yemot-router2, בדיקת התווים הפסולים רצה על *כל*
 * הודעה שה-data שלה מחרוזת — לא רק על טקסט:
 *
 *     if (msg.type === 'text' && removeInvalidChars) { ... }
 *     else { validateCharsForTTS(msg.data, call); }
 *
 * כלומר נתיב קובץ עובר את אותה בדיקה, ו-"ivr2:/1/000.wav" נופל על הנקודה
 * שב-".wav". חשוב לא פחות: removeInvalidChars שמוגדר ברמת הראוטר *אינו*
 * מגן כאן, כי הוא חל רק על type === 'text'. רשת הביטחון הקיימת לא תתפוס
 * את זה.
 *
 * לכן הנתיב מנורמל כאן, והכישלון — אם נשאר — הוא שלנו עם הודעה בעברית,
 * ולא CallError מעורפל מתוך הספרייה.
 */
const YEMOT_FORBIDDEN_CHARS = /[.\-"'&|]/;

export function normalizeYemotFilePath (yemotPath) {
    return String(yemotPath ?? '')
        .trim()
        .replace(/^ivr2:/i, '')        // הקידומת נדרשת ב-API של הורדת קבצים, לא בהשמעה
        .replace(/\.[a-z0-9]{2,5}$/i, ''); // ימות משמיעה לפי שם ללא סיומת
}

export function playFile (yemotPath) {
    const data = normalizeYemotFilePath(yemotPath);

    if (!data) {
        throw new Error('השמעת קובץ: נתיב ריק');
    }

    if (YEMOT_FORBIDDEN_CHARS.test(data)) {
        throw new Error(
            `השמעת קובץ: הנתיב "${data}" מכיל תו שימות פוסלת (. - " ' & |). ` +
            'שמות קבצים להקלטות חייבים להיות בטוחים להשמעה.'
        );
    }

    return { type: 'file', data };
}

/**
 * שם קובץ בטוח להקלטה בימות.
 *
 * ספרות בלבד: מזהה השיחה של ימות עלול להכיל מקפים, ושם שמכיל מקף לא
 * ניתן יהיה להשמיע אחר כך (ראה playFile). חותמת זמן שומרת על סדר כרונולוגי.
 */
export function safeRecordingName (attempt = 0, clock = Date.now()) {
    return `${clock}${attempt}`;
}
