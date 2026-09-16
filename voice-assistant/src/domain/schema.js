/**
 * הסכימה הקשיחה שהמודל חייב להחזיר.
 *
 * אפיון, דרישה 10: אין להסתמך על טקסט חופשי של המודל, והמערכת מבצעת
 * Validation לפני פעולה.
 *
 * אפיון, דרישה 11: המודל מחזיר נתונים בלבד. הוא לא נוגע ב-Drive, ב-Sheets,
 * במערכת התזכורות או בימות. ה-Backend מבצע, אחרי validation ואחרי אישור המשתמש.
 *
 * הערה על השדה reply — זו ההרחבה היחידה מעבר לאפיון המקורי, והיא מכוונת:
 * המשתמש ביקש עוזר שמדבר טבעי ולא רק מחזיר JSON. reply משמש לשיחה בלבד.
 * משפט האישור עצמו *לא* מגיע מכאן, אלא נבנה ב-src/domain/confirmation.js
 * מתוך השדות שעברו validation — כדי שהמודל לא יוכל להכריז על פעולה שלא בוצעה.
 */
import { z } from 'zod';

export const INTENT_TYPES = Object.freeze(['note', 'reminder', 'question', 'unknown']);

/** "+30m", "+2h", "+3d" — קיזוז יחסי שהמודל מזהה אך *לא* מחשב. */
const RELATIVE_PATTERN = /^\+\d{1,4}[mhd]$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * מחרוזת ריקה או "null" מהמודל מנוקות ל-null.
 * מודלים מחזירים מדי פעם את המחרוזת "null" במקום הערך null.
 */
const nullableString = z.preprocess((value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null') return null;
    return trimmed;
}, z.string().nullable());

export const intentSchema = z.object({
    type: z.enum(INTENT_TYPES),

    /** משפט טבעי להקראה. שיחה בלבד — לעולם לא הצהרה על פעולה שבוצעה. */
    reply: z.string().min(1).max(400),

    /** התמלול המלא, מילה במילה. נשמר בנפרד מהכוונה (דרישה 9). */
    transcript: z.string().default(''),

    /** גוף הפתק, או מה שצריך להזכיר — בלי מילות הפקודה. */
    text: nullableString,

    date: nullableString.refine(
        (value) => value === null || DATE_PATTERN.test(value),
        { message: 'date חייב להיות בפורמט YYYY-MM-DD או null' }
    ),

    time: nullableString.refine(
        (value) => value === null || TIME_PATTERN.test(value),
        { message: 'time חייב להיות בפורמט HH:mm בשעון 24 שעות או null' }
    ),

    /** קיזוז יחסי כפי שנאמר ("בעוד חצי שעה"). ה-Backend הוא שממיר אותו לזמן. */
    relative: nullableString.refine(
        (value) => value === null || RELATIVE_PATTERN.test(value),
        { message: 'relative חייב להיראות כמו +30m / +2h / +3d או null' }
    ),

    /**
     * true כשהמודל זיהה שעה בלי לדעת אם בוקר או ערב ("תזכיר לי בעשר").
     * ה-Backend מכריע למופע הקרוב ומקריא את התוצאה לאישור.
     */
    hour_ambiguous: z.boolean().default(false),

    confidence: z.coerce.number().min(0).max(1).default(0),
    needs_clarification: z.boolean().default(false),
    clarification_question: nullableString
}).strip();

/**
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 * לא זורק: קלט פגום מהמודל הוא מצב צפוי שהזרימה מטפלת בו (דרישה 25),
 * לא חריגה שמפילה שיחה.
 */
export function validateIntent (raw) {
    const result = intentSchema.safeParse(raw);
    if (result.success) return { ok: true, value: result.data };

    return {
        ok: false,
        errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    };
}

/** ה-JSON Schema שנשלח למודל עצמו, כדי ששני הצדדים יסכימו על אותו חוזה. */
export const INTENT_RESPONSE_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        type: { type: 'string', enum: [...INTENT_TYPES] },
        reply: { type: 'string' },
        transcript: { type: 'string' },
        text: { type: 'string', nullable: true },
        date: { type: 'string', nullable: true },
        time: { type: 'string', nullable: true },
        relative: { type: 'string', nullable: true },
        hour_ambiguous: { type: 'boolean' },
        confidence: { type: 'number' },
        needs_clarification: { type: 'boolean' },
        clarification_question: { type: 'string', nullable: true }
    },
    required: ['type', 'reply', 'transcript', 'confidence', 'needs_clarification']
});
