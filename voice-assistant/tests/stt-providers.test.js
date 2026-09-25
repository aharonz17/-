import './setup.js';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGroqProvider } from '../src/stt/groq.js';
import { createElevenLabsProvider } from '../src/stt/elevenlabs.js';
import { createProvider, createActiveUnderstandingProvider, AVAILABLE_PROVIDERS } from '../src/ai/index.js';

const realFetch = globalThis.fetch;
let calls = [];
let next = null;

function reply (body, { status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    };
}

beforeEach(() => {
    calls = [];
    next = reply({ text: 'תזכיר לי מחר בעשר להתקשר ליוסי' });
    globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return next;
    };
});

afterEach(() => { globalThis.fetch = realFetch; });

const AUDIO = Buffer.from('fake-phone-audio');

// ---- רישום ----------------------------------------------------------------

test('שני המנועים רשומים וזמינים ל-benchmark', () => {
    assert.ok(AVAILABLE_PROVIDERS.includes('groq'));
    assert.ok(AVAILABLE_PROVIDERS.includes('elevenlabs'));
});

test('מנוע מתמלל בלבד אינו מממש understand', () => {
    // זו ההגנה המבנית שמונעת הפעלה בטעות בשיחה חיה:
    // createActiveUnderstandingProvider בודק בדיוק את זה ונעצר בעלייה.
    assert.equal(typeof createProvider('groq', { apiKey: 'k' }).understand, 'undefined');
    assert.equal(typeof createProvider('elevenlabs', { apiKey: 'k' }).understand, 'undefined');
    assert.equal(typeof createProvider('gemini', { apiKey: 'k' }).understand, 'function');
});

test('ההגדרה הפעילה חייבת להיות מנוע שמבין כוונה', () => {
    // gemini הוא הערך בסביבת הבדיקות, ולכן זה חייב לעבור
    assert.equal(typeof createActiveUnderstandingProvider().understand, 'function');
});

test('ElevenLabs מסומן במפורש כ-benchmark בלבד', () => {
    // הרישיון החינמי אוסר שימוש מסחרי, והסימון הזה הוא התיעוד בקוד
    assert.equal(createProvider('elevenlabs', { apiKey: 'k' }).benchmarkOnly, true);
});

// ---- Groq -----------------------------------------------------------------

test('Groq שולח את המודל והשפה הנכונים ל-endpoint הנכון', async () => {
    const provider = createGroqProvider({ apiKey: 'test-key', model: 'whisper-large-v3-turbo' });
    const result = await provider.transcribeOnly({ audio: AUDIO, mimeType: 'audio/wav' });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');

    const form = calls[0].options.body;
    assert.equal(form.get('model'), 'whisper-large-v3-turbo');
    assert.equal(form.get('language'), 'he', 'בלי זה Whisper מנחש שפה ולעתים מתרגם לאנגלית');
    assert.ok(form.get('file'));

    assert.equal(result.transcript, 'תזכיר לי מחר בעשר להתקשר ליוסי');
    assert.equal(typeof result.latencyMs, 'number');
});

test('Groq דוחה קובץ מעל 25MB לפני שהוא יוצא לרשת', async () => {
    const provider = createGroqProvider({ apiKey: 'k' });
    const huge = Buffer.alloc(26 * 1024 * 1024);

    await assert.rejects(
        () => provider.transcribeOnly({ audio: huge }),
        /25MB/
    );
    assert.equal(calls.length, 0, 'אין טעם לשלוח בקשה שידוע שתיכשל');
});

test('Groq מתרגם שגיאת HTTP להודעה קריאה', async () => {
    next = reply('{"error":{"message":"Invalid API Key"}}', { status: 401 });
    const provider = createGroqProvider({ apiKey: 'bad' });

    await assert.rejects(() => provider.transcribeOnly({ audio: AUDIO }), /HTTP 401/);
});

test('Groq מזהה תשובה שאינה JSON במקום להיכשל בשקט', async () => {
    next = reply('<html>gateway error</html>');
    const provider = createGroqProvider({ apiKey: 'k' });

    await assert.rejects(() => provider.transcribeOnly({ audio: AUDIO }), /שאינה JSON/);
});

test('Groq דורש מפתח', () => {
    assert.throws(() => createGroqProvider({ apiKey: '' }), /GROQ_API_KEY/);
});

// ---- ElevenLabs -----------------------------------------------------------

test('ElevenLabs מזדהה בכותרת xi-api-key ושולח model_id', async () => {
    next = reply({ text: 'רעיון למערכת חדשה ללקוח' });
    const provider = createElevenLabsProvider({ apiKey: 'el-key', model: 'scribe_v1' });
    const result = await provider.transcribeOnly({ audio: AUDIO });

    assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/speech-to-text');
    assert.equal(calls[0].options.headers['xi-api-key'], 'el-key');
    assert.equal(calls[0].options.body.get('model_id'), 'scribe_v1');
    assert.equal(result.transcript, 'רעיון למערכת חדשה ללקוח');
});

test('ElevenLabs מתרגם חריגת מכסה להודעה קריאה', async () => {
    // המכסה החינמית קטנה, וזה התרחיש הצפוי באמצע benchmark
    next = reply('{"detail":"quota_exceeded"}', { status: 401 });
    const provider = createElevenLabsProvider({ apiKey: 'k' });

    await assert.rejects(() => provider.transcribeOnly({ audio: AUDIO }), /HTTP 401/);
});

test('ElevenLabs דורש מפתח', () => {
    assert.throws(() => createElevenLabsProvider({ apiKey: '' }), /ELEVENLABS_API_KEY/);
});

// ---- שילוב עם רתמת המדידה -------------------------------------------------

test('כישלון של מנוע אחד לא מפיל את הרצת ה-benchmark', async () => {
    const { runEngine } = await import('../src/benchmark/runner.js');
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'stt-'));
    const audioPath = join(dir, 'a.wav');
    writeFileSync(audioPath, AUDIO);

    let first = true;
    next = null;
    globalThis.fetch = async () => {
        if (first) { first = false; return reply('nope', { status: 500 }); }
        return reply({ text: 'שלום עולם' });
    };

    const provider = createGroqProvider({ apiKey: 'k' });
    const entries = [
        { file: 'a.wav', audioPath, transcript: 'שלום עולם' },
        { file: 'a.wav', audioPath, transcript: 'שלום עולם' }
    ];

    const summary = await runEngine(provider, entries);

    assert.equal(summary.failed, 1);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.wer.mean, 0);
});
