import './setup.js';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDatabase } from './setup.js';
import { createCallFlow } from '../src/calls/flow.js';
import { createReminderScheduler } from '../src/reminders/scheduler.js';
import { getDb, closeDb, STATUS } from '../src/storage/db.js';
import * as repo from '../src/storage/repository.js';
import { now } from '../src/domain/time.js';
import { playFile, safeRecordingName, normalizeYemotFilePath } from '../src/domain/speech.js';

function makeCall ({ callId = 'call-1', phone = '0501234567', taps = [], recordings = [] } = {}) {
    const spoken = [];
    let tapIndex = 0;
    let recordIndex = 0;

    return {
        callId, phone, did: '0771234567', extension: '1',
        spoken,
        async read (messages, mode) {
            spoken.push({ mode, messages, texts: messages.map((m) => m.data) });
            if (mode === 'record') return recordings[recordIndex++] ?? `ivr2:/1/${recordIndex}.wav`;
            return taps[tapIndex++] ?? '';
        },
        id_list_message (messages) {
            spoken.push({ mode: 'say', messages, texts: messages.map((m) => m.data) });
        },
        hangup () {}
    };
}

const allText = (call) => call.spoken.flatMap((e) => e.texts).join(' | ');

const NOTE_INTENT = {
    type: 'note', reply: 'רשמתי', transcript: 'רעיון',
    text: 'רעיון', date: null, time: null, relative: null,
    hour_ambiguous: false, confidence: 0.9,
    needs_clarification: false, clarification_question: null
};

function makeDeps () {
    return {
        ai: { name: 'stub', async understand () { return { intent: NOTE_INTENT, latencyMs: 50 }; } },
        yemotApi: { async downloadFile () { return Buffer.from('audio'); } },
        archive: { async archive () { return { localPath: '/tmp/x.wav' }; } },
        mirrors: { enqueueForEntry () {} }
    };
}

/** יוצר תזכורת ממתינה עם הקלטה מקורית מקושרת. */
function seedWaitingReminder ({ text = 'להתקשר למשה', daysAgo = 1, yemotPath = 'ivr2:/1/17580.wav' } = {}) {
    const suffix = Math.random().toString(36).slice(2);
    const { recording } = repo.recordRecording({
        callId: `seed-${suffix}`, phone: '0501234567', yemotPath
    });
    const { entry } = repo.saveEntry({
        recordingId: recording.recording_id, callId: recording.call_id,
        type: 'reminder', transcript: text, intent: {}, text,
        status: STATUS.CONFIRMED, confidence: 1, engine: 'stub'
    });
    const reminder = repo.createReminder({
        entryId: entry.entry_id, callId: recording.call_id, text,
        dueAt: now().minus({ days: daysAgo })
    });
    repo.markReminderWaiting(reminder.reminder_id);
    return reminder;
}

beforeEach(() => {
    getDb().exec('DELETE FROM mirror_queue; DELETE FROM reminders; DELETE FROM entries; DELETE FROM recordings;');
});

after(() => {
    closeDb();
    cleanupDatabase();
});

// ---- נורמליזציה של נתיבי קבצים ---------------------------------------------

test('playFile מסירה את הסיומת ואת הקידומת ivr2', () => {
    assert.deepEqual(playFile('ivr2:/1/000.wav'), { type: 'file', data: '/1/000' });
    assert.equal(normalizeYemotFilePath('ivr2:/1/17580.mp3'), '/1/17580');
});

test('playFile זורקת על נתיב שימות תפסול, במקום להיכשל בתוך הספרייה', () => {
    // ימות פוסלת  . - " ' & |  גם בהודעת קובץ, ו-removeInvalidChars
    // ברמת הראוטר לא חל על type: 'file'
    assert.throws(() => playFile('ivr2:/1/call-abc.wav'), /תו שימות פוסלת/);
    assert.throws(() => playFile(''), /נתיב ריק/);
});

test('שם ההקלטה בטוח להשמעה חוזרת', () => {
    assert.equal(/[.\-"'&|]/.test(safeRecordingName(0)), false);
    assert.equal(/[.\-"'&|]/.test(safeRecordingName(2)), false);
});

// ---- מחזור החיים: חיוג אחד ואז המתנה ---------------------------------------

test('תזכורת שחויגה ולא אושרה עוברת ל-WAITING ולא נעלמת', async () => {
    process.env.REMINDERS_OUTBOUND_ENABLED = 'true';

    const { recording } = repo.recordRecording({ callId: 'c1', phone: '0501234567', yemotPath: 'ivr2:/1/1.wav' });
    const { entry } = repo.saveEntry({
        recordingId: recording.recording_id, callId: 'c1', type: 'reminder',
        transcript: 'x', intent: {}, text: 'להתקשר ליוסי',
        status: STATUS.CONFIRMED, confidence: 1, engine: 'stub'
    });
    const reminder = repo.createReminder({
        entryId: entry.entry_id, callId: 'c1', text: 'להתקשר ליוסי',
        dueAt: now().minus({ minutes: 1 })
    });

    const scheduler = createReminderScheduler({
        yemotApi: { async runCampaign () { return { responseStatus: 'OK' }; } }
    });

    const result = await scheduler.tick();

    assert.equal(result.called, 1, 'חויג פעם אחת');
    assert.equal(result.waiting, 1);
    assert.equal(repo.getReminder(reminder.reminder_id).status, STATUS.WAITING);

    // הנקודה המרכזית: היא עדיין קיימת וניתנת לאחזור
    assert.equal(repo.findWaitingReminders().length, 1);

    // ולא תחויג שוב
    const second = await scheduler.tick();
    assert.equal(second.called, 0);

    delete process.env.REMINDERS_OUTBOUND_ENABLED;
});

test('תזכורת ממתינה נשלפת עם נתיב ההקלטה המקורית בשאילתה אחת', () => {
    seedWaitingReminder({ yemotPath: 'ivr2:/1/17580.wav' });
    const waiting = repo.findWaitingReminders();

    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].yemot_path, 'ivr2:/1/17580.wav');
});

// ---- התיבה בשיחה הנכנסת -----------------------------------------------------

test('בלי תזכורות ממתינות, השיחה מתחילה בברכה כרגיל', async () => {
    const call = makeCall({ taps: ['1'] });
    await createCallFlow(makeDeps())(call);

    assert.equal(call.spoken[0].texts[0], 'שלום, אני מקשיב');
});

test('תזכורת בודדת מושמעת ישר, בלי שאלה מקדימה', async () => {
    seedWaitingReminder({ text: 'להתקשר למשה', daysAgo: 1 });

    // 1 = בוצע (לתזכורת), ואז 1 = אישור לפתק החדש
    const call = makeCall({ taps: ['1', '1'] });
    await createCallFlow(makeDeps())(call);

    const firstPrompt = call.spoken[0].texts.join(' ');
    assert.match(firstPrompt, /תזכורת מאתמול/);
    assert.match(firstPrompt, /להתקשר למשה/);
    assert.doesNotMatch(firstPrompt, /יש לך/, 'תזכורת אחת לא אמורה לשאול קודם');
});

test('הקשה 1 סוגרת את התזכורת ומורידה אותה מהתיבה', async () => {
    const reminder = seedWaitingReminder();

    const call = makeCall({ taps: ['1', '1'] });
    await createCallFlow(makeDeps())(call);

    assert.equal(repo.getReminder(reminder.reminder_id).status, STATUS.COMPLETED);
    assert.equal(repo.findWaitingReminders().length, 0);
});

test('כמה תזכורות — נשאלת שאלה, והקשה 2 מדלגת ומשאירה את כולן ממתינות', async () => {
    seedWaitingReminder({ text: 'ראשונה', daysAgo: 3 });
    seedWaitingReminder({ text: 'שנייה', daysAgo: 1 });
    seedWaitingReminder({ text: 'שלישית', daysAgo: 0 });

    const call = makeCall({ taps: ['2', '1'] });
    await createCallFlow(makeDeps())(call);

    assert.match(call.spoken[0].texts.join(' '), /יש לך 3 תזכורות/);
    assert.equal(repo.findWaitingReminders().length, 3, 'דילוג לא סוגר תזכורות');
    assert.match(allText(call), /שלום, אני מקשיב/, 'השיחה ממשיכה כרגיל אחרי הדילוג');
});

test('הקשה 1 בשאלה משמיעה את כולן מהוותיקה לחדשה', async () => {
    seedWaitingReminder({ text: 'הוותיקה', daysAgo: 5 });
    seedWaitingReminder({ text: 'החדשה', daysAgo: 1 });

    // 1 = לשמוע, ואז 1 ו-1 לשתי התזכורות, ואז 1 לפתק
    const call = makeCall({ taps: ['1', '1', '1', '1'] });
    await createCallFlow(makeDeps())(call);

    const text = allText(call);
    assert.ok(text.indexOf('הוותיקה') < text.indexOf('החדשה'), 'סדר כרונולוגי');
    assert.equal(repo.findWaitingReminders().length, 0);
});

test('הקשה 9 משמיעה את ההקלטה המקורית ואז חוזרת לתפריט', async () => {
    const reminder = seedWaitingReminder({ yemotPath: 'ivr2:/1/17580.wav' });

    // 9 = לשמוע הקלטה, ואז 1 = בוצע, ואז 1 לפתק
    const call = makeCall({ taps: ['9', '1', '1'] });
    await createCallFlow(makeDeps())(call);

    const fileMessages = call.spoken
        .flatMap((entry) => entry.messages || [])
        .filter((message) => message.type === 'file');

    assert.equal(fileMessages.length, 1, 'הושמע קובץ אחד');
    assert.equal(fileMessages[0].data, '/1/17580', 'הנתיב מנורמל להשמעה');
    assert.equal(repo.getReminder(reminder.reminder_id).status, STATUS.COMPLETED);
});

test('התפריט לא מציע השמעה חוזרת פעמיים', async () => {
    seedWaitingReminder();

    const call = makeCall({ taps: ['9', '1', '1'] });
    await createCallFlow(makeDeps())(call);

    const menusOfferingReplay = call.spoken
        .filter((entry) => entry.texts.some((text) => text.includes('ההקלטה המקורית')));

    assert.equal(menusOfferingReplay.length, 1, 'הצעה אחת בלבד, אחרת נוצרת לולאה');
});

test('הקשה 2 מתוך התיבה דוחה ומאפסת את מונה הניסיונות', async () => {
    const reminder = seedWaitingReminder();
    repo.markReminderCalled(reminder.reminder_id);

    const call = makeCall({ taps: ['2', '1'] });
    await createCallFlow(makeDeps())(call);

    const updated = repo.getReminder(reminder.reminder_id);
    assert.equal(updated.status, STATUS.SNOOZED);
    assert.equal(updated.attempts, 0, 'דחייה ביוזמת המשתמש מאפסת את המכסה');
    assert.equal(repo.findWaitingReminders().length, 0);
    assert.equal(repo.findDueReminders(now().plus({ hours: 2 })).length, 1, 'חזרה לתזמון');
});

test('אי הקשה משאירה את התזכורת ממתינה לשיחה הבאה', async () => {
    const reminder = seedWaitingReminder();

    // מחרוזת ריקה = לא הוקש כלום
    const call = makeCall({ taps: ['', '1'] });
    await createCallFlow(makeDeps())(call);

    assert.equal(repo.getReminder(reminder.reminder_id).status, STATUS.WAITING);
    assert.equal(repo.findWaitingReminders().length, 1);
});

test('כשל בהשמעת ההקלטה לא מפיל את השיחה', async () => {
    // נתיב שימות תפסול — מקף
    const reminder = seedWaitingReminder({ yemotPath: 'ivr2:/1/bad-name.wav' });

    const call = makeCall({ taps: ['9', '1', '1'] });
    await createCallFlow(makeDeps())(call);

    assert.match(allText(call), /לא הצלחתי להשמיע/);
    assert.equal(repo.getReminder(reminder.reminder_id).status, STATUS.COMPLETED,
        'המשתמש עדיין יכול לסגור את התזכורת');
});

test('תזכורת ממתינה לא חוסמת את מטרת השיחה', async () => {
    seedWaitingReminder();

    const call = makeCall({ taps: ['1', '1'] });
    await createCallFlow(makeDeps())(call);

    assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM entries WHERE type = 'note'").get().n, 1,
        'הפתק החדש נשמר אחרי הטיפול בתזכורת');
});
