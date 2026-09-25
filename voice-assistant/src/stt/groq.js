/**
 * מנוע תמלול Groq — Whisper large-v3-turbo.
 *
 * למה הוא כאן: המכסה החינמית היא 28,800 שניות אודיו ביום (שמונה שעות)
 * ו-2,000 בקשות, וההרצה היא בסדר גודל של פי 200 ממהירות אמת. מבחינת
 * הקמה זה מפתח API יחיד — בלי service account ובלי חיוב.
 *
 * ⚠ ומה שחשוב לא פחות: Groq מריץ את **Whisper המקורי**, שמתועד כחלש
 *   בעברית. בדיוק מהסיבה הזו קיים ivrit.ai, שעשה fine-tune על מאות שעות
 *   עברית. לכן אין כאן הנחה שהמנוע הזה טוב — הוא נוסף כדי שרתמת המדידה
 *   תכריע בשאלה על אודיו טלפוני אמיתי (אפיון, סעיף 24).
 *
 * ה-endpoint תואם OpenAI ואומת בתיעוד Groq:
 *   POST https://api.groq.com/openai/v1/audio/transcriptions
 *   multipart: file, model, language
 */
import { config } from '../config/index.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** מגבלת הקובץ של Groq. הודעה קולית קצרה רחוקה מזה, אבל עדיף להיכשל מסודר. */
const MAX_BYTES = 25 * 1024 * 1024;

const EXTENSION_BY_MIME = {
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac'
};

export function createGroqProvider ({
    apiKey = config.stt.groqApiKey,
    model = config.stt.groqModel,
    language = 'he'
} = {}) {
    if (!apiKey) {
        throw new Error('GROQ_API_KEY חסר — לא ניתן לאתחל את מנוע התמלול של Groq');
    }

    return {
        name: `groq:${model}`,
        model,

        /**
         * @param {Buffer} audio
         * @returns {Promise<{transcript: string, latencyMs: number}>}
         */
        async transcribeOnly ({ audio, mimeType = 'audio/wav', timeoutMs = 30000 }) {
            if (audio.length > MAX_BYTES) {
                throw new Error(
                    `Groq: הקובץ ${(audio.length / 1024 / 1024).toFixed(1)}MB חורג מהמגבלה של 25MB`
                );
            }

            const startedAt = Date.now();

            const form = new FormData();
            form.append(
                'file',
                new Blob([audio], { type: mimeType }),
                `audio.${EXTENSION_BY_MIME[mimeType] || 'wav'}`
            );
            form.append('model', model);
            form.append('language', language);
            // json ולא verbose_json: אין צורך בחותמות זמן, ותשובה קטנה מהירה יותר
            form.append('response_format', 'json');

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetch(ENDPOINT, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${apiKey}` },
                    body: form,
                    signal: controller.signal
                });

                const text = await response.text();

                if (!response.ok) {
                    throw new Error(`Groq: HTTP ${response.status} — ${text.slice(0, 300)}`);
                }

                let body;
                try {
                    body = JSON.parse(text);
                } catch {
                    throw new Error(`Groq: תשובה שאינה JSON — ${text.slice(0, 200)}`);
                }

                return {
                    transcript: String(body.text || '').trim(),
                    latencyMs: Date.now() - startedAt
                };
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw new Error(`Groq: פג הזמן אחרי ${timeoutMs}ms`);
                }
                throw error;
            } finally {
                clearTimeout(timer);
            }
        }
    };
}
