import { cleanupDatabase } from './setup-no-google.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, closeDb } from '../src/storage/db.js';
import { createArchive } from '../src/storage/archive.js';
import { createMirrors } from '../src/storage/mirrors.js';
import * as repo from '../src/storage/repository.js';

after(() => { closeDb(); cleanupDatabase(); });

/** כל כתיבה ל-Google בבדיקה הזו היא באג. */
const failingWriter = new Proxy({}, {
    get: () => async () => { throw new Error('לא אמורה להיות כתיבה ל-Google'); }
});

test('בלי Google, ההקלטה נשמרת בדיסק ולא נכנסת לתור ה-Drive', async () => {
    getDb();
    const { recording } = repo.recordRecording({
        callId: 'c-local', phone: '0501234567', yemotPath: 'ivr2:/1/001.wav'
    });

    const archive = createArchive();
    const { localPath } = await archive.archive({ recording, audio: Buffer.from('RIFF') });

    assert.ok(localPath.endsWith('.wav'));
    assert.equal(repo.getRecording(recording.recording_id).local_path, localPath);
    assert.equal(repo.claimPendingMirrorWrites({ limit: 50 }).length, 0);
});

test('בלי Google, רשומה שאושרה לא יוצרת משימות Sheets או Docs שייכשלו לנצח', async () => {
    const { recording } = repo.recordRecording({
        callId: 'c-entry', phone: '0501234567', yemotPath: 'ivr2:/1/002.wav'
    });
    const { entry } = repo.saveEntry({
        recordingId: recording.recording_id, callId: recording.call_id,
        type: 'note', transcript: 'רעיון למערכת חדשה ללקוח', intent: {},
        text: 'רעיון למערכת חדשה ללקוח', status: 'CONFIRMED', confidence: 1, engine: 'stub'
    });

    const mirrors = createMirrors({ drive: failingWriter, sheets: failingWriter, docs: failingWriter });
    mirrors.enqueueForEntry({ recording, entry, reminder: null });

    const result = await mirrors.flush();
    assert.deepEqual(result, { processed: 0, failed: 0 });
});
