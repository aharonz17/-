/**
 * מנוע תמלול ElevenLabs Scribe.
 *
 * ⚠ **ל-Benchmark בלבד.** המכסה החינמית של ElevenLabs אינה כוללת רישיון
 *   מסחרי, והיא בסדר גודל של כ-30 דקות בחודש. היא מספיקה בדיוק כדי להריץ
 *   30–50 הקלטות קצרות פעם אחת ולראות מספרים — לא לשימוש יומיומי.
 *
 *   הגנה מבנית: הספק הזה לא מממש understand, ו-createActiveUnderstandingProvider
 *   דוחה מנוע כזה. כלומר אי אפשר להפעיל אותו בטעות בשיחה חיה.
 *
 * למה בכל זאת: ElevenLabs טוענת לתוצאות הטובות ביותר בעברית (3.1% WER
 * ב-FLEURS). **זו טענה של הספק עצמו**, על הקלטות אולפן נקיות — ואצלנו
 * האודיו הוא 8 קילוהרץ מקו טלפון. בשביל זה בדיוק נועדה המדידה.
 *
 * ה-endpoint אומת בתיעוד ElevenLabs:
 *   POST https://api.elevenlabs.io/v1/speech-to-text
 *   כותרת xi-api-key, multipart: file, model_id
 */
import { config } from '../config/index.js';

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';

export function createElevenLabsProvider ({
    apiKey = config.stt.elevenLabsApiKey,
    model = config.stt.elevenLabsModel,
    languageCode = 'heb'
} = {}) {
    if (!apiKey) {
        throw new Error('ELEVENLABS_API_KEY חסר — לא ניתן לאתחל את מנוע התמלול של ElevenLabs');
    }

    return {
        name: `elevenlabs:${model}`,
        model,

        /** ל-benchmark בלבד. ראה ההערה בראש הקובץ. */
        benchmarkOnly: true,

        async transcribeOnly ({ audio, mimeType = 'audio/wav', timeoutMs = 60000 }) {
            const startedAt = Date.now();

            const form = new FormData();
            form.append('file', new Blob([audio], { type: mimeType }), 'audio.wav');
            form.append('model_id', model);
            form.append('language_code', languageCode);

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetch(ENDPOINT, {
                    method: 'POST',
                    headers: { 'xi-api-key': apiKey },
                    body: form,
                    signal: controller.signal
                });

                const text = await response.text();

                if (!response.ok) {
                    throw new Error(`ElevenLabs: HTTP ${response.status} — ${text.slice(0, 300)}`);
                }

                let body;
                try {
                    body = JSON.parse(text);
                } catch {
                    throw new Error(`ElevenLabs: תשובה שאינה JSON — ${text.slice(0, 200)}`);
                }

                return {
                    transcript: String(body.text || '').trim(),
                    latencyMs: Date.now() - startedAt
                };
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw new Error(`ElevenLabs: פג הזמן אחרי ${timeoutMs}ms`);
                }
                throw error;
            } finally {
                clearTimeout(timer);
            }
        }
    };
}
