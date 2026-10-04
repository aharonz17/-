import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { wordErrorRate, semanticMatch, normalizeHebrew, median } from '../src/benchmark/metrics.js';
import { runEngine } from '../src/benchmark/runner.js';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('WER מתעלם מפיסוק ומניקוד אבל לא ממילים', () => {
    assert.equal(wordErrorRate('שלום, מה שלומך?', 'שלום מה שלומך'), 0);
    assert.ok(wordErrorRate('שלום מה שלומך', 'שלום מה נשמע') > 0);
});

test('נרמול משאיר אותיות סופיות, כדי לא להסתיר שגיאות אמיתיות', () => {
    assert.equal(normalizeHebrew('כלב'), 'כלב');
    assert.notEqual(normalizeHebrew('כלב'), normalizeHebrew('כלך'));
});

test('תמלול ריק נספר כשגיאה מלאה ולא כהצלחה', () => {
    assert.equal(wordErrorRate('שלוש מילים כאן', ''), 1);
});

test('שעה שגויה נכשלת סמנטית גם כשהתמלול מושלם — סעיף 24 באפיון', () => {
    const result = semanticMatch(
        { type: 'reminder', time: '22:00', text: 'להתקשר ליוסי' },
        { type: 'reminder', time: '10:00', text: 'להתקשר ליוסי' }
    );
    assert.equal(result.allPassed, false);
    assert.equal(result.checks.time, false);
    assert.equal(result.checks.text, true, 'התוכן כן הובן נכון');
});

test('מילה אחת שונה בתוכן עדיין נחשבת הבנה נכונה', () => {
    const result = semanticMatch(
        { type: 'note', text: 'לבדוק את המייל של הלקוח' },
        { type: 'note', text: 'לבדוק את המייל של הלקוחה' }
    );
    assert.equal(result.checks.text, true);
});

test('חציון עמיד לקריאה בודדת שנתקעה', () => {
    assert.equal(median([100, 110, 120, 130, 9000]), 120);
});

test('רתמת ההרצה סופרת כשלים ואינה מפילה את ההרצה כולה', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-'));
    const audioPath = join(dir, 'a.wav');
    writeFileSync(audioPath, Buffer.from('not-real-audio'));

    const entries = [
        { file: 'a.wav', audioPath, transcript: 'שלום עולם', type: 'note' },
        { file: 'a.wav', audioPath, transcript: 'שלום עולם', type: 'note' }
    ];

    let callCount = 0;
    const flakyProvider = {
        name: 'flaky',
        async transcribeOnly () {
            callCount += 1;
            if (callCount === 1) throw new Error('timeout');
            return { transcript: 'שלום עולם', latencyMs: 50 };
        }
    };

    const summary = await runEngine(flakyProvider, entries);

    assert.equal(summary.total, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.succeeded, 1);
    assert.equal(summary.wer.mean, 0, 'ההרצה שהצליחה נמדדה כרגיל');
});
