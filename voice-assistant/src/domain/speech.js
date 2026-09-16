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
