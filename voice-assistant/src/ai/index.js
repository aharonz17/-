/**
 * רישום מנועים והחלפה ביניהם.
 *
 * סעיף 34 באפיון: המערכת בנויה כך שניתן להחליף כל רכיב בנפרד.
 * המנוע הפעיל בשיחה נקבע ב-ACTIVE_TRANSCRIBER, וה-Benchmark של שלב 0
 * מריץ את כולם על אותם קבצים.
 *
 * הבדל שחשוב לשמור עליו: understand קיים רק במנוע שמבין כוונה,
 * transcribeOnly קיים בכולם. מנוע תמלול טהור לא יכול לשמש בשיחה חיה
 * בלי שכבת הבנה מעליו — ולכן elevenlabs+qwen עוטף אותו בשלב הבנה.
 */
import { config } from '../config/index.js';
import { createGeminiProvider } from './gemini.js';
import { createGoogleSttProvider } from '../stt/google-stt.js';
import { createGroqProvider } from '../stt/groq.js';
import { createElevenLabsProvider } from '../stt/elevenlabs.js';
import { createGroqTextUnderstanding } from './groq-text.js';
import { createTwoStageProvider } from './two-stage.js';

/**
 * ElevenLabs שומע, Qwen על Groq מבין. הנבחר במדידה של 04/10/2026:
 * 13/21 מול 6/21 ל-Whisper, ו-9/10 שעות נכונות מול 5/10.
 */
function createElevenLabsQwenProvider (options = {}) {
    return createTwoStageProvider({
        name: 'elevenlabs+qwen',
        transcriber: createElevenLabsProvider(options.transcriber),
        understander: createGroqTextUnderstanding(options.understander)
    });
}

const FACTORIES = {
    gemini: createGeminiProvider,
    'google-stt': createGoogleSttProvider,
    groq: createGroqProvider,
    elevenlabs: createElevenLabsProvider,
    'elevenlabs+qwen': createElevenLabsQwenProvider
};

export function createProvider (name, options = {}) {
    const factory = FACTORIES[name];
    if (!factory) {
        throw new Error(`מנוע לא מוכר: "${name}". קיימים: ${Object.keys(FACTORIES).join(', ')}`);
    }
    return factory(options);
}

/** המנוע שמשמש בשיחה חיה. חייב לתמוך ב-understand. */
export function createActiveUnderstandingProvider () {
    const provider = createProvider(config.activeTranscriber);

    if (typeof provider.understand !== 'function') {
        throw new Error(
            `ACTIVE_TRANSCRIBER="${config.activeTranscriber}" הוא מנוע תמלול בלבד ואינו מבין כוונה.\n` +
            'לשיחה חיה נדרש מנוע שמחזיר תמלול, כוונה ותשובה: gemini, או elevenlabs+qwen.\n' +
            'המנועים האחרים קיימים להשוואה ב-npm run benchmark.'
        );
    }
    return provider;
}

export const AVAILABLE_PROVIDERS = Object.keys(FACTORIES);
