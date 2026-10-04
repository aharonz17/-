/**
 * שלב ההבנה מטקסט — מודל שפה על Groq.
 *
 * זה החצי השני של המסלול הדו-שלבי (ראה two-stage.js): מנוע תמלול הופך את
 * הקול לטקסט, וכאן מודל שפה מבין מהטקסט מה המשתמש ביקש.
 *
 * למה Qwen ולא Gemini: מדידה ב-04/10/2026 על 30 משפטי ה-benchmark כטקסט —
 * qwen/qwen3.8-27b הבין נכון 30 מתוך 30 (סוג, תוכן ושעה), כולל "הערב בעשר"
 * כ-22:00, בחציון של פחות מחצי שנייה. openai/gpt-oss-120b הגיע ל-27/30.
 * שניהם במכסה החינמית של Groq. Gemini, באותו יום, דרש חשבון בתשלום מראש.
 *
 * החוזה זהה ל-Gemini: אותה הנחיה, אותה סכימה, אותו validateIntent. זה מה
 * שמאפשר להחליף מנוע בשורה אחת ב-.env בלי לגעת בזרימת השיחה.
 *
 * ה-endpoint תואם OpenAI ואומת מול Groq:
 *   POST https://api.groq.com/openai/v1/chat/completions
 */
import { config } from '../config/index.js';
import { SYSTEM_INSTRUCTION, TEXT_INPUT_NOTE, buildContextBlock } from './prompt.js';
import { validateIntent } from '../domain/schema.js';
import { now, hebrewWeekday } from '../domain/time.js';
import { AiResponseError } from './gemini.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * המכסה החינמית של Groq מוגבלת ל-7,000 טוקנים של קלט בדקה, וכל פנייה כאן
 * היא כ-1,500 (בעיקר ההנחיה). כלומר 4–5 הודעות בדקה — הרבה מעבר לשימוש אישי,
 * אבל רצף מהיר (או benchmark) נתקל ב-429. Groq אומר כמה לחכות; מחכים פעם
 * אחת, רק אם ההמתנה נכנסת בתקציב הזמן שנשאר.
 */
export function retryDelayMs (response, body) {
    const header = Number(response.headers?.get?.('retry-after'));
    if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1000);

    const match = /try again in ([\d.]+)s/.exec(body);
    return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * מודלי reasoning מחזירים לפעמים בלוק <think> לפני ה-JSON, או JSON עטוף
 * בגדר קוד. מנקים לפני הפענוח במקום להיכשל.
 */
export function extractJson (text) {
    const withoutThinking = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(withoutThinking);
    return fenced ? fenced[1] : withoutThinking;
}

export function createGroqTextUnderstanding ({
    apiKey = config.stt.groqApiKey,
    model = config.stt.groqTextModel
} = {}) {
    if (!apiKey) {
        throw new Error('GROQ_API_KEY חסר — לא ניתן לאתחל את שלב ההבנה של Groq');
    }

    return {
        name: `groq:${model}`,
        model,

        /**
         * טקסט נכנס, כוונה מאומתת יוצאת.
         * @param {string} transcript התמלול שהגיע ממנוע התמלול
         * @returns {Promise<{intent: object, raw: string, latencyMs: number}>}
         * @throws {AiResponseError} כשהמודל החזיר JSON לא תקין או שלא עבר validation
         */
        async understandText ({ transcript, reference = now(), timeoutMs = 15000 }) {
            const startedAt = Date.now();

            const contextBlock = buildContextBlock({
                nowText: reference.toFormat('dd/MM/yyyy HH:mm'),
                weekday: hebrewWeekday(reference)
            });

            const request = {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    temperature: 0,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: `${SYSTEM_INSTRUCTION}\n\n${TEXT_INPUT_NOTE}` },
                        { role: 'user', content: `${contextBlock}\n\nהתמלול:\n${transcript}` }
                    ]
                })
            };

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            let raw;
            try {
                let response = await fetch(ENDPOINT, { ...request, signal: controller.signal });
                let text = await response.text();

                if (response.status === 429) {
                    const wait = retryDelayMs(response, text);
                    const left = timeoutMs - (Date.now() - startedAt) - 2000;
                    if (wait !== null && wait <= left) {
                        await sleep(wait);
                        response = await fetch(ENDPOINT, { ...request, signal: controller.signal });
                        text = await response.text();
                    }
                }

                if (!response.ok) {
                    throw new Error(`Groq: HTTP ${response.status} — ${text.slice(0, 300)}`);
                }

                try {
                    raw = JSON.parse(text).choices?.[0]?.message?.content ?? '';
                } catch {
                    throw new Error(`Groq: תשובה שאינה JSON — ${text.slice(0, 200)}`);
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw new Error(`Groq: פג הזמן אחרי ${timeoutMs}ms`);
                }
                throw error;
            } finally {
                clearTimeout(timer);
            }

            let parsed;
            try {
                parsed = JSON.parse(extractJson(raw));
            } catch (error) {
                throw new AiResponseError(`המודל החזיר JSON לא תקין: ${error.message}`, { raw });
            }

            // התמלול הוא של מנוע התמלול, לא של מודל השפה. מודל שמ"תקן" את
            // הטקסט היה מסתיר בדיוק את טעויות השמיעה שהמשתמש צריך לראות.
            parsed.transcript = transcript;

            const validation = validateIntent(parsed);
            if (!validation.ok) {
                throw new AiResponseError('תשובת המודל לא עברה validation', {
                    raw,
                    errors: validation.errors
                });
            }

            return { intent: validation.value, raw, latencyMs: Date.now() - startedAt };
        }
    };
}
