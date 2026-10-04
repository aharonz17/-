import './setup.js';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGroqTextUnderstanding, extractJson, retryDelayMs } from '../src/ai/groq-text.js';
import { createTwoStageProvider } from '../src/ai/two-stage.js';
import { createProvider, AVAILABLE_PROVIDERS } from '../src/ai/index.js';
import { AiResponseError } from '../src/ai/gemini.js';

const realFetch = globalThis.fetch;
let calls = [];
let replies = [];

function reply (body, { status = 200, headers = {} } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    };
}

/** תשובת chat completions של Groq שתוכנה הוא content. */
function chat (content) {
    return reply({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] });
}

const GOOD_INTENT = {
    type: 'reminder',
    reply: 'בסדר, הבנתי',
    transcript: 'טקסט שהמודל ניסה לתקן',
    text: 'להתקשר ליוסי',
    date: null,
    time: '10:00',
    relative: null,
    hour_ambiguous: false,
    confidence: 0.9,
    needs_clarification: false,
    clarification_question: null
};

beforeEach(() => {
    calls = [];
    replies = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return replies.shift();
    };
});

afterEach(() => { globalThis.fetch = realFetch; });

const AUDIO = Buffer.from('fake-phone-audio');

// ---- שלב ההבנה -------------------------------------------------------------

test('שלב ההבנה שולח את ההנחיה והתמלול ל-Groq ומחזיר כוונה מאומתת', async () => {
    replies.push(chat(GOOD_INTENT));
    const understander = createGroqTextUnderstanding({ apiKey: 'g-key', model: 'qwen/qwen3.8-27b' });

    const { intent } = await understander.understandText({ transcript: 'תזכיר לי מחר בעשר בבוקר להתקשר ליוסי' });

    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer g-key');

    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, 'qwen/qwen3.8-27b');
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.match(body.messages[0].content, /אל תחשב תאריכים/, 'אותה הנחיה כמו ב-Gemini');
    assert.match(body.messages[0].content, /אתה מקבל טקסט, לא אודיו/);
    assert.match(body.messages[1].content, /להתקשר ליוסי/);

    assert.equal(intent.type, 'reminder');
    assert.equal(intent.time, '10:00');
});

test('התמלול נשאר של מנוע התמלול גם כשמודל השפה "מתקן" אותו', async () => {
    // אחרת טעויות שמיעה נעלמות מהלוג ומהמסך, ואי אפשר לראות מה באמת נשמע
    replies.push(chat(GOOD_INTENT));
    const understander = createGroqTextUnderstanding({ apiKey: 'k' });

    const { intent } = await understander.understandText({ transcript: 'תזכיר למחר בעשר להתקשר ליוסף' });

    assert.equal(intent.transcript, 'תזכיר למחר בעשר להתקשר ליוסף');
});

test('בלוק <think> וגדר קוד מנוקים לפני הפענוח', () => {
    assert.equal(extractJson('<think>חושב...</think>\n```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(extractJson('{"a":1}'), '{"a":1}');
});

test('JSON שבור מהמודל הופך ל-AiResponseError, כמו ב-Gemini', async () => {
    replies.push(chat('זה לא JSON'));
    const understander = createGroqTextUnderstanding({ apiKey: 'k' });

    await assert.rejects(
        () => understander.understandText({ transcript: 'משהו' }),
        (error) => error instanceof AiResponseError && /JSON לא תקין/.test(error.message)
    );
});

test('כוונה שלא עוברת validation נדחית ולא מגיעה לזרימה', async () => {
    replies.push(chat({ ...GOOD_INTENT, time: '25:99' }));
    const understander = createGroqTextUnderstanding({ apiKey: 'k' });

    await assert.rejects(
        () => understander.understandText({ transcript: 'משהו' }),
        (error) => error instanceof AiResponseError && error.errors.some((e) => e.startsWith('time'))
    );
});

test('שגיאת HTTP מ-Groq מתורגמת להודעה קריאה', async () => {
    replies.push(reply('{"error":{"message":"invalid key"}}', { status: 401 }));
    const understander = createGroqTextUnderstanding({ apiKey: 'k' });

    await assert.rejects(() => understander.understandText({ transcript: 'משהו' }), /HTTP 401/);
});

test('שלב ההבנה דורש מפתח', () => {
    assert.throws(() => createGroqTextUnderstanding({ apiKey: '' }), /GROQ_API_KEY/);
});

// ---- המנוע הדו-שלבי --------------------------------------------------------

test('elevenlabs+qwen רשום ומממש understand, ולכן מותר בשיחה חיה', () => {
    assert.ok(AVAILABLE_PROVIDERS.includes('elevenlabs+qwen'));

    const provider = createProvider('elevenlabs+qwen', {
        transcriber: { apiKey: 'el' },
        understander: { apiKey: 'g' }
    });
    assert.equal(typeof provider.understand, 'function');
    assert.equal(typeof provider.transcribeOnly, 'function');
    assert.equal(provider.name, 'elevenlabs+qwen');
});

test('הקול עובר ל-ElevenLabs, והטקסט שיצא ממנו עובר ל-Groq', async () => {
    replies.push(reply({ text: 'תזכיר לי מחר בעשר בבוקר להתקשר ליוסי' }));
    replies.push(chat(GOOD_INTENT));

    const provider = createProvider('elevenlabs+qwen', {
        transcriber: { apiKey: 'el' },
        understander: { apiKey: 'g' }
    });
    const result = await provider.understand({ audio: AUDIO });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/speech-to-text');
    assert.equal(calls[1].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.match(JSON.parse(calls[1].options.body).messages[1].content, /תזכיר לי מחר בעשר בבוקר להתקשר ליוסי/);

    assert.equal(result.intent.text, 'להתקשר ליוסי');
    assert.equal(result.intent.transcript, 'תזכיר לי מחר בעשר בבוקר להתקשר ליוסי');
    assert.equal(typeof result.stages.transcribeMs, 'number');
    assert.equal(typeof result.stages.understandMs, 'number');
});

test('כשהתמלול נכשל, שלב ההבנה לא נקרא בכלל', async () => {
    replies.push(reply('{"detail":"quota_exceeded"}', { status: 401 }));

    const provider = createProvider('elevenlabs+qwen', {
        transcriber: { apiKey: 'el' },
        understander: { apiKey: 'g' }
    });

    await assert.rejects(() => provider.understand({ audio: AUDIO }), /ElevenLabs: HTTP 401/);
    assert.equal(calls.length, 1);
});

test('שלב ההבנה מקבל את מה שנשאר מתקציב הזמן, ולא פחות מ-5 שניות', async () => {
    let seenTimeout;
    const provider = createTwoStageProvider({
        name: 'test',
        transcriber: { model: 't', transcribeOnly: async () => ({ transcript: 'שלום', latencyMs: 1 }) },
        understander: {
            model: 'u',
            understandText: async ({ timeoutMs }) => {
                seenTimeout = timeoutMs;
                return { intent: GOOD_INTENT, raw: '{}', latencyMs: 1 };
            }
        }
    });

    await provider.understand({ audio: AUDIO, timeoutMs: 20000 });
    assert.ok(seenTimeout > 19000 && seenTimeout <= 20000);

    await provider.understand({ audio: AUDIO, timeoutMs: 1000 });
    assert.equal(seenTimeout, 5000);
});

// ---- מגבלת הקצב של Groq -----------------------------------------------------

const RATE_LIMITED = '{"error":{"message":"Rate limit reached ... Please try again in 0.05s."}}';

test('זמן ההמתנה נקרא מהכותרת retry-after, ואם אין — מגוף ההודעה', () => {
    assert.equal(retryDelayMs({ headers: { get: () => '2' } }, ''), 2000);
    assert.equal(retryDelayMs({ headers: { get: () => null } }, 'Please try again in 7.93s.'), 7930);
    assert.equal(retryDelayMs({ headers: { get: () => null } }, 'something else'), null);
});

test('429 עם זמן המתנה קצר — מחכים פעם אחת ומצליחים', async () => {
    replies.push(reply(RATE_LIMITED, { status: 429 }));
    replies.push(chat(GOOD_INTENT));
    const understander = createGroqTextUnderstanding({ apiKey: 'k' });

    const { intent } = await understander.understandText({ transcript: 'משהו' });
    assert.equal(calls.length, 2);
    assert.equal(intent.type, 'reminder');
});

test('429 פעמיים — לא מנסים שוב לנצח, מדווחים', async () => {
    replies.push(reply(RATE_LIMITED, { status: 429 }));
    replies.push(reply(RATE_LIMITED, { status: 429 }));
    const understander = createGroqTextUnderstanding({ apiKey: 'k' });

    await assert.rejects(() => understander.understandText({ transcript: 'משהו' }), /HTTP 429/);
    assert.equal(calls.length, 2);
});

test('429 שההמתנה שלו חורגת מתקציב הזמן — לא מחכים בכלל', async () => {
    // בשיחה חיה עדיף להיכשל מהר ולבקש מהמשתמש לחזור, מאשר שתיקה ארוכה
    replies.push(reply('{"error":{"message":"Please try again in 30s."}}', { status: 429 }));
    const understander = createGroqTextUnderstanding({ apiKey: 'k' });

    const startedAt = Date.now();
    await assert.rejects(() => understander.understandText({ transcript: 'משהו', timeoutMs: 15000 }), /HTTP 429/);
    assert.equal(calls.length, 1);
    assert.ok(Date.now() - startedAt < 1000);
});
