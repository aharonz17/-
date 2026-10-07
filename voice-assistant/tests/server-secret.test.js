import './setup.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http/server.js';

const SECRET = process.env.WEBHOOK_SECRET;
const YEMOT = 'ApiCallId=c1&ApiYFCallId=y1&ApiDID=0771234567&ApiRealDID=0771234567&ApiPhone=0501234567&ApiExtension=&ApiTime=1';

let server;
let base;
let handled;

before(async () => {
    const app = createServer({
        handleCall: async (call) => { handled++; call.id_list_message([{ type: 'text', data: 'שלום' }]); },
        mirrors: { flush: async () => ({}) }
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function get (path) {
    handled = 0;
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: await response.text() };
}

test('הסוד בנתיב — הצורה שהסקריפט מדפיס — מגיע לשיחה', async () => {
    const { status, body } = await get(`/yemot/${SECRET}?${YEMOT}`);
    assert.equal(status, 200);
    assert.match(body, /id_list_message=t-שלום/);
    assert.equal(handled, 1);
});

test('סוד שגוי בנתיב נדחה לפני השיחה', async () => {
    const { status } = await get(`/yemot/wrong-secret-value-123456789?${YEMOT}`);
    assert.equal(status, 403);
    assert.equal(handled, 0);
});

test('הצורה הישנה, ?secret=, עדיין עובדת', async () => {
    const { status } = await get(`/yemot?secret=${SECRET}&${YEMOT}`);
    assert.equal(status, 200);
    assert.equal(handled, 1);
});

test('סוד כפול ב-query (מערך) — נבדק הראשון, ולא מפיל את השרת', async () => {
    assert.equal((await get(`/yemot?secret=${SECRET}&secret=x&${YEMOT}`)).status, 200);
    assert.equal((await get(`/yemot?secret=x&secret=${SECRET}&${YEMOT}`)).status, 403);
});

test('כשימות מצרפת את הפרמטרים שלה עם ? נוסף — הסוד בנתיב לא נפגע', async () => {
    // בצורה הישנה זה בדיוק מה שמשבר את הסוד: secret=<סוד>?ApiCallId=...
    assert.equal((await get(`/yemot?secret=${SECRET}?${YEMOT}`)).status, 403);
    assert.equal((await get(`/yemot/${SECRET}?${YEMOT}`)).status, 200);
});

test('בלי סוד בכלל — נדחה', async () => {
    assert.equal((await get(`/yemot?${YEMOT}`)).status, 403);
});
