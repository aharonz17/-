import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIntent } from '../src/domain/schema.js';
import { sanitizeForSpeech, say } from '../src/domain/speech.js';
import { confirmReminder, confirmNote, askForMissing } from '../src/domain/confirmation.js';
import { fromStorage } from '../src/domain/time.js';

test('כוונה תקינה עוברת validation', () => {
    const result = validateIntent({
        type: 'reminder', reply: 'בסדר', transcript: 'תזכיר לי מחר בעשר',
        text: 'להתקשר ליוסי', date: '2026-09-17', time: '10:00', confidence: 0.9
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.type, 'reminder');
});

test('המחרוזת "null" מהמודל מתורגמת ל-null אמיתי', () => {
    const result = validateIntent({ type: 'note', reply: 'ok', date: 'null', time: '  ' });
    assert.equal(result.ok, true);
    assert.equal(result.value.date, null);
    assert.equal(result.value.time, null);
});

test('שעה לא חוקית נדחית ולא מגיעה לפעולה', () => {
    const result = validateIntent({ type: 'reminder', reply: 'x', time: '25:99' });
    assert.equal(result.ok, false);
    assert.ok(result.errors[0].includes('time'));
});

test('סוג לא מוכר נדחה', () => {
    assert.equal(validateIntent({ type: 'launch_missiles', reply: 'x' }).ok, false);
});

test('תשובה בלי reply נדחית', () => {
    assert.equal(validateIntent({ type: 'note' }).ok, false);
});

test('relative בפורמט שגוי נדחה', () => {
    assert.equal(validateIntent({ type: 'reminder', reply: 'x', relative: 'בעוד חצי שעה' }).ok, false);
    assert.equal(validateIntent({ type: 'reminder', reply: 'x', relative: '+30m' }).ok, true);
});

test('שדות עודפים מהמודל מושמטים ולא מגיעים למסד הנתונים', () => {
    const result = validateIntent({ type: 'note', reply: 'x', evil_field: 'DROP TABLE' });
    assert.equal(result.ok, true);
    assert.equal(result.value.evil_field, undefined);
});

// ---- תווים פסולים ב-TTS של ימות -------------------------------------------
// ימות פוסלת  . - " ' & |  בהקראת טקסט. אומת מול lib/response-functions.js
// של yemot-router2, ששם invalidCharsRgx = /[.\-"'&|]/g
const YEMOT_INVALID = /[.\-"'&|]/;

test('ניקוי לדיבור מסיר כל תו שימות פוסלת', () => {
    const dirty = 'רעיון - לבנות מערכת "חכמה" & לבדוק מחיר.';
    assert.equal(YEMOT_INVALID.test(sanitizeForSpeech(dirty)), false);
});

test('מקף מוחלף ברווח ולא נמחק, כדי ש-10-30 לא ייקרא כ-1030', () => {
    assert.equal(sanitizeForSpeech('בשעה 10-30'), 'בשעה 10 30');
});

test('משפט האישור לתזכורת נקי מתווים פסולים', () => {
    const ref = fromStorage('2026-09-16T14:00:00+03:00');
    const at = fromStorage('2026-09-17T10:30:00+03:00');
    const sentence = confirmReminder('להתקשר לדוד ולשלוח לו את המסמך.', at, ref);

    assert.equal(YEMOT_INVALID.test(sentence), false);
    assert.ok(sentence.includes('מחר'));
    assert.ok(sentence.includes('10:30'));
});

test('משפט האישור לפתק נקי מתווים פסולים', () => {
    assert.equal(YEMOT_INVALID.test(confirmNote('רעיון - וואטסאפ & הנהלת חשבונות.')), false);
});

test('הודעת TTS נבנית מנוקה ועם רשת ביטחון', () => {
    const message = say('בדיקה. עם נקודה - ומקף');
    assert.equal(message.type, 'text');
    assert.equal(YEMOT_INVALID.test(message.data), false);
    assert.equal(message.removeInvalidChars, true);
});

test('שאלות ההבהרה ממוקדות לפי מה שחסר', () => {
    assert.ok(askForMissing('needs_time').includes('שעה'));
    assert.ok(askForMissing('needs_date').includes('יום'));
    assert.ok(askForMissing('unreasonable', 'past').includes('עבר'));
});
