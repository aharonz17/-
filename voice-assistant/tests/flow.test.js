import './setup.js';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDatabase } from './setup.js';
import { createCallFlow } from '../src/calls/flow.js';
import { getDb, closeDb } from '../src/storage/db.js';
import * as repo from '../src/storage/repository.js';

/**
 * כפיל של אובייקט Call של yemot-router2.
 * מתעד מה הושמע למשתמש, כדי שאפשר יהיה לבדוק *מה נאמר לו* ולא רק מה נשמר.
 */
function makeCall ({ callId = 'call-1', phone = '0501234567', taps = [], recordings = [] } = {}) {
    const spoken = [];
    let tapIndex = 0;
    let recordIndex = 0;

    return {
        callId, phone, did: '0771234567', extension: '1',
        spoken,
        async read (messages, mode) {
            spoken.push({ mode, texts: messages.map((m) => m.data) });
            if (mode === 'record') return recordings[recordIndex++] ?? `ivr2:/1/${recordIndex}.wav`;
            return taps[tapIndex++] ?? '1';
        },
        id_list_message (messages) {
            spoken.push({ mode: 'say', texts: messages.map((m) => m.data) });
        },
        hangup () { spoken.push({ mode: 'hangup', texts: [] }); }
    };
}

function allSpokenText (call) {
    return call.spoken.flatMap((entry) => entry.texts).join(' | ');
}

const VALID_REMINDER = {
    type: 'reminder', reply: 'בסדר גמור', transcript: 'תזכיר לי מחר בעשר בבוקר להתקשר ליוסי',
    text: 'להתקשר ליוסי', date: null, time: '10:00', relative: null,
    hour_ambiguous: true, confidence: 0.95, needs_clarification: false, clarification_question: null
};

const VALID_NOTE = {
    type: 'note', reply: 'רשמתי לפניי', transcript: 'רעיון למערכת חדשה ללקוח',
    text: 'רעיון למערכת חדשה ללקוח', date: null, time: null, relative: null,
    hour_ambiguous: false, confidence: 0.9, needs_clarification: false, clarification_question: null
};

/** בונה את התלויות של הזרימה עם מרגלים, בלי רשת. */
function makeDeps ({ intent = VALID_NOTE, understandError = null, downloadError = null } = {}) {
    const archived = [];
    const mirrored = [];

    return {
        archived,
        mirrored,
        deps: {
            ai: {
                name: 'stub',
                async understand () {
                    if (understandError) throw understandError;
                    return { intent, latencyMs: 120 };
                }
            },
            yemotApi: {
                async downloadFile (path) {
                    if (downloadError) throw downloadError;
                    return Buffer.from(`fake-audio-for-${path}`);
                }
            },
            archive: {
                async archive ({ recording, audio }) {
                    archived.push({ recordingId: recording.recording_id, bytes: audio.length });
                    return { localPath: `/tmp/${recording.recording_id}.wav` };
                }
            },
            mirrors: {
                enqueueForEntry (input) { mirrored.push(input); }
            }
        }
    };
}

beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM mirror_queue; DELETE FROM reminders; DELETE FROM entries; DELETE FROM recordings;');
});

after(() => {
    closeDb();
    cleanupDatabase();
});

test('מספר לא מורשה נדחה בצד השרת ולא מגיע להקלטה', async () => {
    const { deps, archived } = makeDeps();
    const call = makeCall({ phone: '0509999999' });

    await createCallFlow(deps)(call);

    assert.match(allSpokenText(call), /אינו מורשה/);
    assert.equal(archived.length, 0, 'לא אמורה להתבצע הקלטה למספר לא מורשה');
});

test('פתק נשמר רק אחרי הקשה 1', async () => {
    const { deps, mirrored } = makeDeps({ intent: VALID_NOTE });
    const call = makeCall({ taps: ['1'] });

    await createCallFlow(deps)(call);

    const entries = getDb().prepare('SELECT * FROM entries').all();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, 'note');
    assert.equal(entries[0].status, 'CONFIRMED');
    assert.equal(mirrored.length, 1, 'שכבות התצוגה מתוזמנות אחרי האישור');
    assert.match(allSpokenText(call), /הפתק נשמר/);
});

test('הקשה 2 לא שומרת כלום ומבקשת להקליט מחדש', async () => {
    const { deps, mirrored } = makeDeps({ intent: VALID_NOTE });
    // 2 בפעם הראשונה, 2 בשנייה, 2 בשלישית -> מיצוי ניסיונות
    const call = makeCall({ taps: ['2', '2', '2'] });

    await createCallFlow(deps)(call);

    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM entries').get().n, 0,
        'הקשה 2 אסור שתשמור רשומה');
    assert.equal(mirrored.length, 0);
    assert.match(allSpokenText(call), /תגיד שוב/);
});

test('תזכורת נוצרת רק אחרי אישור, עם זמן שחושב ב-Backend', async () => {
    const { deps } = makeDeps({ intent: VALID_REMINDER });
    const call = makeCall({ taps: ['1'] });

    await createCallFlow(deps)(call);

    const reminders = getDb().prepare('SELECT * FROM reminders').all();
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].text, 'להתקשר ליוסי');
    assert.equal(reminders[0].status, 'CONFIRMED');
    assert.match(allSpokenText(call), /התזכורת נשמרה/);
});

test('משפט האישור מגיע מה-Backend ומכיל את הזמן המחושב, לא רק את reply של המודל', async () => {
    const { deps } = makeDeps({ intent: VALID_REMINDER });
    const call = makeCall({ taps: ['1'] });

    await createCallFlow(deps)(call);

    const confirmationTurn = call.spoken.find((entry) => entry.mode === 'tap');
    const spokenText = confirmationTurn.texts.join(' ');

    assert.ok(spokenText.includes('הבנתי'), 'חייב להופיע משפט אישור של המערכת');
    assert.ok(spokenText.includes('10:00') || spokenText.includes('22:00'),
        'משפט האישור חייב להקריא את השעה שחושבה');
    assert.ok(spokenText.includes('לאישור הקש 1'));
});

test('תזכורת בלי שעה מובילה לשאלה ולא לניחוש', async () => {
    const intent = { ...VALID_REMINDER, time: null, date: null, relative: null, hour_ambiguous: false };
    const { deps } = makeDeps({ intent });
    const call = makeCall({ taps: ['1', '1', '1'] });

    await createCallFlow(deps)(call);

    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM reminders').get().n, 0,
        'אסור ליצור תזכורת כשחסרה שעה');
    assert.match(allSpokenText(call), /שעה/);
});

test('כשל תמלול לא מאבד את האודיו', async () => {
    const { deps, archived } = makeDeps({ understandError: new Error('Gemini לא זמין') });
    const call = makeCall({ taps: ['1'] });

    await createCallFlow(deps)(call);

    assert.ok(archived.length >= 1, 'האודיו חייב להישמר גם כשהתמלול נכשל');
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM recordings').get().n, archived.length);
    assert.match(allSpokenText(call), /לא הצלחתי להבין|תקלה טכנית/);
});

test('כשל הורדה מימות מדווח למשתמש ולא מפיל את השרת', async () => {
    const { deps } = makeDeps({ downloadError: new Error('DownloadFile: HTTP 500') });
    const call = makeCall({ taps: ['1'] });

    await createCallFlow(deps)(call);

    assert.match(allSpokenText(call), /תקלה טכנית/);
});

test('בקשה כפולה מימות אינה יוצרת שתי הקלטות', async () => {
    const { deps } = makeDeps({ intent: VALID_NOTE });
    const flow = createCallFlow(deps);

    // אותו callId ואותו נתיב הקלטה — בדיוק מה שקורה ב-retry של ימות
    await flow(makeCall({ callId: 'dup-call', recordings: ['ivr2:/1/same.wav'], taps: ['1'] }));
    await flow(makeCall({ callId: 'dup-call', recordings: ['ivr2:/1/same.wav'], taps: ['1'] }));

    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM recordings').get().n, 1,
        'דרישה 19: אסור ליצור רשומה כפולה');
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM entries').get().n, 1);
});

test('needs_clarification מהמודל מוביל לשאלה ולא לשמירה', async () => {
    const intent = {
        ...VALID_NOTE, needs_clarification: true,
        clarification_question: 'לא שמעתי טוב, אפשר לחזור?'
    };
    const { deps } = makeDeps({ intent });
    const call = makeCall({ taps: ['1', '1', '1'] });

    await createCallFlow(deps)(call);

    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM entries').get().n, 0);
    assert.match(allSpokenText(call), /לא שמעתי טוב/);
});

test('שרשרת המעקב של דרישה 23 שלמה מתזכורת עד ההקלטה', async () => {
    const { deps } = makeDeps({ intent: VALID_REMINDER });
    await createCallFlow(deps)(makeCall({ taps: ['1'] }));

    const reminder = getDb().prepare('SELECT * FROM reminders').get();
    const trace = repo.traceReminder(reminder.reminder_id);

    assert.ok(trace.reminder, 'תזכורת');
    assert.ok(trace.entry, 'רשומה');
    assert.ok(trace.recording, 'הקלטה');
    assert.equal(trace.entry.recording_id, trace.recording.recording_id);
    assert.ok(trace.entry.transcript, 'התמלול נשמר');
    assert.ok(trace.entry.parsed_intent, 'הכוונה נשמרה בנפרד מהתמלול');
});
