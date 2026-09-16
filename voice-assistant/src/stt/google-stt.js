/**
 * מנוע תמלול Google Speech-to-Text V2.
 *
 * קיים כאן בעיקר בשביל שלב 0: אי אפשר לבחור מנוע תמלול לעברית בלי למדוד,
 * ואי אפשר למדוד בלי שני מנועים מאחורי אותו ממשק (סעיף 34 באפיון).
 *
 * הערה שאסור לאבד: תמיכת עברית לפי דגם *לא אומתה* מול התיעוד של Google
 * בזמן כתיבת הקוד, כי הדומיין חסום בסביבת הפיתוח שבה נכתב. לכן
 * listSupportedModels כאן שואל את ה-API החי במקום להסתמך על טבלה בקוד.
 * אין להניח שדגם כלשהו תומך בעברית לפני שהריצו את bin/check-stt-models.js.
 */
import speech from '@google-cloud/speech';
import { config } from '../config/index.js';

const DEFAULT_LOCATION = 'global';

/** ברירת המחדל. iw-IL הוא הקוד ההיסטורי של עברית אצל Google, ולא he-IL. */
export const HEBREW_LANGUAGE_CODE = 'iw-IL';

export function createGoogleSttProvider ({
    projectId = config.google.projectId,
    location = DEFAULT_LOCATION,
    model = 'chirp_2',
    languageCode = HEBREW_LANGUAGE_CODE
} = {}) {
    if (!projectId) {
        throw new Error('GOOGLE_PROJECT_ID חסר — לא ניתן לאתחל את מנוע התמלול של Google');
    }

    // ה-endpoint האזורי חייב להתאים ל-location, אחרת הבקשה נדחית.
    const client = new speech.v2.SpeechClient(
        location === DEFAULT_LOCATION
            ? {}
            : { apiEndpoint: `${location}-speech.googleapis.com` }
    );

    const recognizer = `projects/${projectId}/locations/${location}/recognizers/_`;

    return {
        name: `google-stt:${model}`,
        model,

        /**
         * @param {Buffer} audio
         * @returns {Promise<{transcript: string, latencyMs: number, confidence: number}>}
         */
        async transcribeOnly ({ audio }) {
            const startedAt = Date.now();

            const [response] = await client.recognize({
                recognizer,
                config: {
                    // autoDecodingConfig נותן ל-Google לזהות את פורמט הקובץ.
                    // ההקלטות מימות מגיעות כ-WAV, אבל הפורמט עלול להשתנות
                    // לפי הגדרות השלוחה, ולכן לא מקבעים encoding כאן.
                    autoDecodingConfig: {},
                    languageCodes: [languageCode],
                    model
                },
                content: audio
            });

            const latencyMs = Date.now() - startedAt;

            const results = response.results || [];
            const transcript = results
                .map((result) => result.alternatives?.[0]?.transcript || '')
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();

            const confidences = results
                .map((result) => result.alternatives?.[0]?.confidence)
                .filter((value) => typeof value === 'number');

            const confidence = confidences.length > 0
                ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
                : 0;

            return { transcript, latencyMs, confidence };
        },

        /**
         * שואל את ה-API החי אילו דגמים ושפות זמינים בפועל.
         * זו הדרך היחידה לענות על "האם עברית נתמכת בדגם X" בלי לנחש.
         */
        async listSupportedModels () {
            const [locationInfo] = await client.getLocation?.({ name: `projects/${projectId}/locations/${location}` })
                .catch(() => [null]) || [null];
            return locationInfo;
        },

        client,
        recognizer
    };
}
