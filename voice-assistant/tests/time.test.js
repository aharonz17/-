import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyRelative, resolveAmbiguousHour, resolveReminderTime,
    describeForSpeech, fromStorage, hebrewDayHeading
} from '../src/domain/time.js';

/** יום רביעי, 16/09/2026, 14:00 שעון ישראל. */
const REF = fromStorage('2026-09-16T14:00:00+03:00');

test('קיזוז יחסי מחושב ב-Backend ולא על ידי המודל', () => {
    assert.equal(applyRelative('+30m', REF).toFormat('HH:mm'), '14:30');
    assert.equal(applyRelative('+2h', REF).toFormat('HH:mm'), '16:00');
    assert.equal(applyRelative('+1d', REF).toFormat('yyyy-MM-dd'), '2026-09-17');
    assert.equal(applyRelative('bogus', REF), null);
});

test('"בעשר" בשעה 14:00 מוכרע ל-22:00, המופע הקרוב', () => {
    assert.equal(resolveAmbiguousHour('10:00', REF).toFormat('yyyy-MM-dd HH:mm'), '2026-09-16 22:00');
});

test('"בשלוש" בשעה 14:00 מוכרע ל-15:00 באותו יום', () => {
    assert.equal(resolveAmbiguousHour('03:00', REF).toFormat('yyyy-MM-dd HH:mm'), '2026-09-16 15:00');
});

test('שעה דו-משמעית שכל מופעיה היום עברו עוברת למחר', () => {
    const lateNight = fromStorage('2026-09-16T23:30:00+03:00');
    const resolved = resolveAmbiguousHour('10:00', lateNight);
    assert.equal(resolved.toFormat('yyyy-MM-dd HH:mm'), '2026-09-17 10:00');
});

test('חסרה שעה — המערכת שואלת ולא מנחשת', () => {
    assert.deepEqual(
        resolveReminderTime({ text: 'להתקשר ליוסי' }, REF),
        { ok: false, reason: 'needs_time' }
    );
});

test('שעה בלי יום ובלי דו-משמעות — המערכת שואלת באיזה יום', () => {
    assert.deepEqual(
        resolveReminderTime({ time: '08:00' }, REF),
        { ok: false, reason: 'needs_date' }
    );
});

test('תאריך בעבר נדחה ואינו הופך לתזכורת', () => {
    const result = resolveReminderTime({ date: '2020-01-01', time: '10:00' }, REF);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unreasonable');
    assert.equal(result.detail, 'past');
});

test('תאריך רחוק מדי נדחה', () => {
    const result = resolveReminderTime({ date: '2099-01-01', time: '10:00' }, REF);
    assert.equal(result.ok, false);
    assert.equal(result.detail, 'too_far');
});

test('תאריך ושעה מפורשים מתקבלים', () => {
    const result = resolveReminderTime({ date: '2026-09-17', time: '10:30' }, REF);
    assert.equal(result.ok, true);
    assert.equal(result.at.toFormat('yyyy-MM-dd HH:mm'), '2026-09-17 10:30');
});

test('ניסוח הזמן להקראה הוא טבעי ומכיל גם את התאריך', () => {
    const at = fromStorage('2026-09-17T10:30:00+03:00');
    assert.equal(describeForSpeech(at, REF), 'מחר, 17 בספטמבר, בשעה 10:30');
});

test('כותרת יום ליומן ה-Docs', () => {
    assert.equal(hebrewDayHeading(REF), 'יום רביעי, 16 בספטמבר 2026');
});

test('חישובי הזמן חוצים מעבר שעון קיץ בלי לזוז', () => {
    // מעבר לשעון חורף בישראל ב-2026 חל בסוף אוקטובר.
    const beforeChange = fromStorage('2026-10-24T10:00:00+03:00');
    const result = resolveReminderTime({ date: '2026-10-26', time: '10:00' }, beforeChange);
    assert.equal(result.ok, true);
    // השעה שהמשתמש ביקש נשמרת כשעת קיר, לא מוזזת בשעה
    assert.equal(result.at.toFormat('HH:mm'), '10:00');
});
