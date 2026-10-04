/**
 * מימוש Gemini של ממשק ההבנה.
 *
 * ההחלטה הארכיטקטונית: קריאה אחת מקבלת את האודיו ומחזירה גם תמלול, גם
 * כוונה מובנית וגם משפט טבעי. במסלול של שני שלבים (תמלול, ואז מודל נפרד)
 * יש שני round trips בתוך שיחת טלפון פעילה, וזה נשמע למשתמש כמו שתיקה.
 *
 * הממשק נשמר צר בכוונה (understand / transcribeOnly) כדי שיהיה אפשר להחליף
 * מנוע בלי לגעת בשאר המערכת — סעיף 34 באפיון.
 */
import { GoogleGenAI, createPartFromBase64, createUserContent } from '@google/genai';
import { config } from '../config/index.js';
import { SYSTEM_INSTRUCTION, buildContextBlock } from './prompt.js';
import { INTENT_RESPONSE_SCHEMA, validateIntent } from '../domain/schema.js';
import { now, hebrewWeekday } from '../domain/time.js';

export class AiResponseError extends Error {
    constructor (message, { raw, errors } = {}) {
        super(message);
        this.name = 'AiResponseError';
        this.raw = raw;
        this.errors = errors;
    }
}

/**
 * מודלים מחזירים לפעמים JSON עטוף בגדר קוד, למרות responseMimeType.
 * מנקים לפני הפענוח במקום להיכשל.
 */
function extractJson (text) {
    const trimmed = String(text || '').trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
    return fenced ? fenced[1] : trimmed;
}

export function createGeminiProvider ({ apiKey = config.google.geminiApiKey, model = config.google.geminiModel } = {}) {
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY חסר — לא ניתן לאתחל את מנוע ההבנה');
    }

    const client = new GoogleGenAI({ apiKey });

    async function generate ({ audio, mimeType, systemInstruction, responseSchema, extraText, timeoutMs }) {
        const controller = new AbortController();
        const timer = timeoutMs
            ? setTimeout(() => controller.abort(), timeoutMs)
            : null;

        try {
            const parts = [createPartFromBase64(audio.toString('base64'), mimeType)];
            if (extraText) parts.push({ text: extraText });

            const response = await client.models.generateContent({
                model,
                contents: createUserContent(parts),
                config: {
                    systemInstruction,
                    temperature: 0,
                    responseMimeType: 'application/json',
                    responseJsonSchema: responseSchema,
                    abortSignal: controller.signal
                }
            });

            return response.text;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    return {
        name: 'gemini',
        model,

        /**
         * אודיו נכנס, כוונה מאומתת יוצאת.
         * @param {Buffer} audio
         * @param {string} mimeType
         * @returns {Promise<{intent: object, raw: string, latencyMs: number}>}
         * @throws {AiResponseError} כשהמודל החזיר JSON לא תקין או שלא עבר validation
         */
        async understand ({ audio, mimeType = 'audio/wav', reference = now(), timeoutMs = 20000 }) {
            const startedAt = Date.now();

            const contextBlock = buildContextBlock({
                nowText: reference.toFormat('dd/MM/yyyy HH:mm'),
                weekday: hebrewWeekday(reference)
            });

            const raw = await generate({
                audio,
                mimeType,
                systemInstruction: SYSTEM_INSTRUCTION,
                responseSchema: INTENT_RESPONSE_SCHEMA,
                extraText: contextBlock,
                timeoutMs
            });

            const latencyMs = Date.now() - startedAt;

            let parsed;
            try {
                parsed = JSON.parse(extractJson(raw));
            } catch (error) {
                throw new AiResponseError(`המודל החזיר JSON לא תקין: ${error.message}`, { raw });
            }

            const validation = validateIntent(parsed);
            if (!validation.ok) {
                throw new AiResponseError('תשובת המודל לא עברה validation', {
                    raw,
                    errors: validation.errors
                });
            }

            return { intent: validation.value, raw, latencyMs };
        },

        /**
         * תמלול בלבד, לצורך ה-Benchmark של שלב 0.
         * מאפשר השוואה הוגנת מול מנוע תמלול ייעודי על אותו קובץ.
         */
        async transcribeOnly ({ audio, mimeType = 'audio/wav', timeoutMs = 20000 }) {
            const startedAt = Date.now();

            const raw = await generate({
                audio,
                mimeType,
                systemInstruction: 'תמלל את ההקלטה לעברית, מילה במילה, בלי לתקן ובלי להוסיף. החזר JSON: {"transcript": "..."}',
                responseSchema: {
                    type: 'object',
                    properties: { transcript: { type: 'string' } },
                    required: ['transcript']
                },
                timeoutMs
            });

            const latencyMs = Date.now() - startedAt;

            try {
                const parsed = JSON.parse(extractJson(raw));
                return { transcript: String(parsed.transcript || '').trim(), latencyMs };
            } catch (error) {
                throw new AiResponseError(`תמלול: JSON לא תקין (${error.message})`, { raw });
            }
        }
    };
}
