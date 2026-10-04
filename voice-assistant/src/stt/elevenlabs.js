/**
 * מנוע תמלול ElevenLabs Scribe.
 *
 * נמדד על 21 הקלטות טלפון אמיתיות של המשתמש (04/10/2026): 27% WER מול
 * 50% ל-Whisper של Groq, ו-9 מתוך 10 שעות נכונות מול 5 מתוך 10. זה המנוע
 * ששומע במסלול הפעיל elevenlabs+qwen (ראה src/ai/two-stage.js).
 *
 * לבדו הוא מתמלל בלבד ולא מממש understand, ולכן לא ניתן להגדיר אותו ישירות
 * כמנוע השיחה. createActiveUnderstandingProvider דוחה מנוע כזה.
 *
 * ⚠ רישיון: המכסה החינמית (10,000 קרדיטים בחודש, כ-330 לדקת אודיו — כלומר
 *   כ-30 דקות, כ-600 הודעות של 3 שניות) מותרת לשימוש אישי בלבד, לא מסחרי.
 *   לשימוש מסחרי נדרשת תוכנית Starter ומעלה.
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

        /** המכסה החינמית לשימוש אישי בלבד. ראה ההערה בראש הקובץ. */
        freeTierNonCommercial: true,

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
