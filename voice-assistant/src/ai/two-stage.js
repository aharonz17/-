/**
 * מנוע דו-שלבי: תמלול, ואז הבנה מהטקסט.
 *
 * Gemini עושה את שניהם בקריאה אחת. כאן הם מופרדים, כי המדידה על הקלטות
 * הטלפון האמיתיות (04/10/2026, 21 הקלטות) הראתה שהשלב החלש הוא השמיעה,
 * לא ההבנה: אותו מודל הבנה הגיע ל-6/21 מעל Whisper של Groq ול-13/21 מעל
 * ElevenLabs Scribe. הפרדה מאפשרת להחליף כל שלב בנפרד.
 *
 * המחיר: שתי פניות ברשת במקום אחת. במדידה — כ-1.3 שניות לתמלול וכחצי
 * שנייה להבנה. latencyMs מדווח את הסכום, ו-stages את הפירוק, כדי שהלוג
 * יראה איזה שלב איטי.
 *
 * מבחוץ זה נראה כמו כל מנוע אחר: understand ו-transcribeOnly.
 */
import { now } from '../domain/time.js';

export function createTwoStageProvider ({ name, transcriber, understander }) {
    return {
        name,
        model: `${transcriber.model} → ${understander.model}`,

        async understand ({ audio, mimeType = 'audio/wav', reference = now(), timeoutMs = 20000 }) {
            const startedAt = Date.now();

            const heard = await transcriber.transcribeOnly({ audio, mimeType, timeoutMs });

            // מה שנשאר מהתקציב אחרי התמלול, ולא פחות מ-5 שניות
            const remaining = Math.max(5000, timeoutMs - (Date.now() - startedAt));
            const understood = await understander.understandText({
                transcript: heard.transcript,
                reference,
                timeoutMs: remaining
            });

            return {
                intent: understood.intent,
                raw: understood.raw,
                latencyMs: Date.now() - startedAt,
                stages: { transcribeMs: heard.latencyMs, understandMs: understood.latencyMs }
            };
        },

        transcribeOnly (args) {
            return transcriber.transcribeOnly(args);
        }
    };
}
