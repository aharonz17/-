import './setup.js';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createYemotApi, YemotApiError } from '../src/voice/yemot-api.js';

const realFetch = globalThis.fetch;
let calls = [];
let queue = [];

/** תשובת JSON כמו שימות מחזירה: תמיד HTTP 200, גם על כישלון לוגי. */
function json (body) {
    return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
        text: async () => JSON.stringify(body),
        arrayBuffer: async () => Buffer.from(JSON.stringify(body))
    };
}

function audio (bytes = 'fake-audio-bytes') {
    return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'audio/wav' : null) },
        text: async () => bytes,
        arrayBuffer: async () => Buffer.from(bytes)
    };
}

const AUTH_REJECTION = {
    yemotAPIVersion: 7,
    responseStatus: 'EXCEPTION',
    message: 'IllegalStateException(session token is invalid)'
};

const LOGIN_OK = { responseStatus: 'OK', token: 'SESSION-TOKEN-XYZ', yemotAPIVersion: 7 };

beforeEach(() => {
    calls = [];
    queue = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        if (queue.length === 0) throw new Error(`אין תשובה בתור עבור ${url}`);
        return queue.shift();
    };
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

const commandsCalled = () => calls.map((url) => new URL(url).pathname.split('/').pop());
const tokenIn = (url) => new URL(url).searchParams.get('token');

test('הטוקן הישיר מצליח — אין התחברות מיותרת', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json({ responseStatus: 'OK', data: 'x' }));
    const result = await api.request('RunTzintuk', { phones: '0501234567' });

    assert.equal(result.responseStatus, 'OK');
    assert.deepEqual(commandsCalled(), ['RunTzintuk'], 'קריאה אחת בלבד, בלי Login');
    assert.equal(tokenIn(calls[0]), '0771234567:testpass', 'נשלח הטוקן הישיר');
});

test('דחיית אימות מפעילה התחברות אחת וניסיון חוזר שמצליח', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json(AUTH_REJECTION));                       // הטוקן הישיר נדחה
    queue.push(json(LOGIN_OK));                             // Login
    queue.push(json({ responseStatus: 'OK', data: 'ok' })); // ניסיון חוזר

    const result = await api.request('RunCampaign', { phones: [{ phone: '0501234567' }] });

    assert.equal(result.responseStatus, 'OK');
    assert.deepEqual(commandsCalled(), ['RunCampaign', 'Login', 'RunCampaign']);
    assert.equal(tokenIn(calls[2]), 'SESSION-TOKEN-XYZ', 'הניסיון החוזר משתמש בטוקן הסשן');
});

test('דחייה גם אחרי התחברות נזרקת, בלי לולאה', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json(AUTH_REJECTION));
    queue.push(json(LOGIN_OK));
    queue.push(json(AUTH_REJECTION));

    await assert.rejects(
        () => api.request('RunTzintuk', { phones: '05' }),
        YemotApiError
    );

    assert.equal(calls.length, 3, 'בדיוק שלוש קריאות — ניסיון, התחברות, ניסיון חוזר');
});

test('שגיאה שאינה אימות לא מפעילה התחברות', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json({ responseStatus: 'ERROR', message: 'path not found' }));

    await assert.rejects(() => api.request('RunTzintuk', {}), YemotApiError);

    assert.deepEqual(commandsCalled(), ['RunTzintuk'], 'אין Login על שגיאת נתיב');
});

test('Login שנכשל אינו מנסה שוב מעצמו', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json(AUTH_REJECTION));
    queue.push(json({ responseStatus: 'ERROR', message: 'סיסמה שגויה' }));

    await assert.rejects(() => api.request('RunTzintuk', {}), /Login נדחה/);

    assert.equal(calls.length, 2, 'ניסיון אחד ואז Login אחד, ועוצרים');
});

test('טוקן הסשן נשמר ומשמש בקריאה הבאה בלי Login נוסף', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json(AUTH_REJECTION));
    queue.push(json(LOGIN_OK));
    queue.push(json({ responseStatus: 'OK' }));
    await api.request('RunTzintuk', {});

    calls = [];
    queue.push(json({ responseStatus: 'OK' }));
    await api.request('RunCampaign', { phones: [{ phone: '05' }] });

    assert.deepEqual(commandsCalled(), ['RunCampaign'], 'בלי Login חוזר');
    assert.equal(tokenIn(calls[0]), 'SESSION-TOKEN-XYZ');
});

test('הורדת הקלטה מתאוששת מדחיית אימות', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json(AUTH_REJECTION));   // ימות מחזירה JSON במקום אודיו
    queue.push(json(LOGIN_OK));
    queue.push(audio('real-recording'));

    const buffer = await api.downloadFile('ivr2:/1/000.wav');

    assert.equal(buffer.toString(), 'real-recording');
    assert.deepEqual(commandsCalled(), ['DownloadFile', 'Login', 'DownloadFile']);
});

test('הורדה שנכשלת מסיבה אחרת אינה מפעילה התחברות', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json({ responseStatus: 'ERROR', message: 'file not found' }));

    await assert.rejects(() => api.downloadFile('ivr2:/1/nope.wav'), /שגיאה במקום קובץ/);
    assert.deepEqual(commandsCalled(), ['DownloadFile']);
});

test('נתיב ריק נדחה לפני שיוצאת בקשה', async () => {
    const api = createYemotApi();
    await assert.rejects(() => api.downloadFile(''), /נתיב ריק/);
    assert.equal(calls.length, 0);
});

test('הסיסמה אינה דולפת להודעת השגיאה', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json(AUTH_REJECTION));
    queue.push(json({ responseStatus: 'ERROR', message: 'נדחה' }));

    const error = await api.request('RunTzintuk', {}).catch((e) => e);
    assert.equal(error.message.includes('testpass'), false, 'הסיסמה לא בהודעה');
});

test('verifyToken מזדהה דרך Login ולא דרך endpoint לא מאומת', async () => {
    const api = createYemotApi();
    api.resetSession();

    queue.push(json(LOGIN_OK));
    const result = await api.verifyToken();

    assert.equal(result.responseStatus, 'OK');
    assert.equal(result.hasSessionToken, true);
    assert.deepEqual(commandsCalled(), ['Login'], 'רק Login, בלי GetSession');
});
