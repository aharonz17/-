import './setup.js';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDatabase } from './setup.js';
import { getDb, closeDb } from '../src/storage/db.js';
import { createMirrors } from '../src/storage/mirrors.js';
import * as repo from '../src/storage/repository.js';

function seedEntry ({ withDriveLink = true } = {}) {
    const { recording } = repo.recordRecording({
        callId: `c-${Math.random()}`, phone: '0501234567',
        yemotPath: `ivr2:/1/${Math.random()}.wav`
    });

    if (withDriveLink) {
        repo.attachRecordingArtifacts(recording.recording_id, {
            driveFileId: 'file-1', driveLink: 'https://drive.example/file-1'
        });
    }

    const { entry } = repo.saveEntry({
        recordingId: recording.recording_id, callId: recording.call_id,
        type: 'note', transcript: 'רעיון', intent: {}, text: 'רעיון',
        status: 'CONFIRMED', confidence: 1, engine: 'stub'
    });

    return { recording: repo.getRecording(recording.recording_id), entry };
}

beforeEach(() => {
    getDb().exec('DELETE FROM mirror_queue; DELETE FROM reminders; DELETE FROM entries; DELETE FROM recordings;');
});

after(() => {
    closeDb();
    cleanupDatabase();
});

test('כתיבת Docs ממתינה לקישור ההקלטה ואינה כותבת שורה בלי קישור', async () => {
    const { recording, entry } = seedEntry({ withDriveLink: false });

    let docsCalls = 0;
    const mirrors = createMirrors({
        drive: { async uploadRecording () { return { fileId: 'x', link: 'https://drive/x' }; } },
        sheets: { async appendEntry () {} },
        docs: { async appendEntry () { docsCalls += 1; } }
    });

    mirrors.enqueueForEntry({ recording, entry, reminder: null });
    const result = await mirrors.flush();

    assert.equal(docsCalls, 0, 'אין לכתוב ל-Docs לפני שיש קישור להקלטה');
    assert.equal(result.failed, 1, 'המשימה נשארת בתור לניסיון חוזר');
});

test('כשיש קישור, Sheets ו-Docs נכתבים ומסומנים כהושלמו', async () => {
    const { recording, entry } = seedEntry({ withDriveLink: true });

    const written = [];
    const mirrors = createMirrors({
        drive: { async uploadRecording () { return { fileId: 'x', link: 'https://drive/x' }; } },
        sheets: { async appendEntry () { written.push('sheets'); } },
        docs: { async appendEntry (input) { written.push('docs'); assert.ok(input.recordingLink); } }
    });

    mirrors.enqueueForEntry({ recording, entry, reminder: null });
    const result = await mirrors.flush();

    assert.deepEqual(written.sort(), ['docs', 'sheets']);
    assert.equal(result.processed, 2);
    assert.equal(result.failed, 0);
});

test('ריקון חוזר לא כותב פעמיים את אותה רשומה', async () => {
    const { recording, entry } = seedEntry();

    let sheetsCalls = 0;
    const mirrors = createMirrors({
        drive: { async uploadRecording () { return { fileId: 'x', link: 'https://drive/x' }; } },
        sheets: { async appendEntry () { sheetsCalls += 1; } },
        docs: { async appendEntry () {} }
    });

    mirrors.enqueueForEntry({ recording, entry, reminder: null });
    mirrors.enqueueForEntry({ recording, entry, reminder: null });

    await mirrors.flush();
    await mirrors.flush();

    assert.equal(sheetsCalls, 1, 'דרישה 19: שורה אחת בלבד ב-Sheet');
});

test('כישלון חוזר מפסיק לנסות אחרי מכסת הניסיונות', async () => {
    const { recording, entry } = seedEntry();

    const mirrors = createMirrors({
        drive: { async uploadRecording () { throw new Error('Drive למטה'); } },
        sheets: { async appendEntry () { throw new Error('Sheets למטה'); } },
        docs: { async appendEntry () { throw new Error('Docs למטה'); } }
    });

    mirrors.enqueueForEntry({ recording, entry, reminder: null });

    for (let i = 0; i < 8; i += 1) await mirrors.flush();

    const pending = repo.claimPendingMirrorWrites({ maxAttempts: 6 });
    assert.equal(pending.length, 0, 'משימה שנכשלה שוב ושוב יוצאת מהתור הפעיל');

    const rows = getDb().prepare('SELECT * FROM mirror_queue').all();
    assert.ok(rows.every((row) => row.last_error), 'השגיאה נשמרת לצורך איתור תקלה');
});
