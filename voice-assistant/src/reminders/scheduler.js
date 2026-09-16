/**
 * תזכורות ושיחות חוזרות — שלב D.
 *
 * ⚠ מצב הרכיב: הקוד כאן מלא ואמיתי, אבל מסלול החיוג היוצא **לא אומת
 *   מול ימות** (אפיון, דרישה 2 ודרישה 28). שתי שאלות פתוחות:
 *
 *     1. כיצד מעבירים שיחת קמפיין לשלוחת API כדי לקלוט הקשות 1/2/3.
 *     2. מה עלות החיוג היוצא בפועל — היא משפיעה על מדיניות הניסיונות
 *        החוזרים (סעיף 17: 3 ניסיונות = פי 3 עלות לכל תזכורת שפוספסה).
 *
 *   לכן החיוג היוצא כבוי כברירת מחדל ונדרשת הפעלה מפורשת ב-
 *   REMINDERS_OUTBOUND_ENABLED=true. כשהוא כבוי, התזכורות עדיין נוצרות,
 *   מתוזמנות ומדווחות בלוג — פשוט לא מחייגות. זה מכוון: עדיף רכיב
 *   שמצהיר שהוא לא מאומת מאשר רכיב שמתנהג כאילו הוא כן.
 *
 * מנגנון התזמון: סריקה תקופתית של הטבלה, לא טיימר בזיכרון.
 * דרישה 18 מחייבת תזכורות אמינות, וטיימר בזיכרון נמחק עם המופע —
 * ב-Cloud Run זה קורה כל הזמן. סריקה גם מחזירה לחיים תזכורות
 * שפוספסו בזמן השבתה, במקום שייעלמו בשקט.
 */
import { logger } from '../logging/logger.js';
import { EVENTS } from '../logging/events.js';
import { config } from '../config/index.js';
import { now, fromStorage } from '../domain/time.js';
import { reminderCallScript } from '../domain/confirmation.js';
import * as repo from '../storage/repository.js';

export function outboundEnabled () {
    return process.env.REMINDERS_OUTBOUND_ENABLED === 'true';
}

export function createReminderScheduler ({ yemotApi }) {
    /**
     * האם מיצינו את ניסיונות החיוג לתזכורת הזו.
     * הערכים מגיעים מהגדרות ולא hard-coded (סעיף 17 ודרישה 21).
     */
    function attemptsExhausted (reminder) {
        return reminder.attempts >= config.reminders.retryCount;
    }

    /** מרווח ההמתנה עד הניסיון הבא, לפי מספר הניסיונות שכבר בוצעו. */
    function nextRetryDelayMinutes (reminder) {
        const delays = config.reminders.retryDelaysMinutes;
        const index = Math.min(reminder.attempts, delays.length - 1);
        return delays[index];
    }

    async function placeCall (reminder, log) {
        const script = reminderCallScript(
            reminder.text,
            config.reminders.snoozeShortMinutes,
            config.reminders.snoozeLongMinutes
        );

        if (!outboundEnabled()) {
            log.warn('חיוג יוצא כבוי — התזכורת הגיעה לזמנה אך לא בוצע חיוג', {
                reminderId: reminder.reminder_id,
                dueAt: reminder.due_at,
                wouldSay: script.body,
                howToEnable: 'REMINDERS_OUTBOUND_ENABLED=true אחרי אימות מול ימות'
            });
            return { placed: false, reason: 'outbound_disabled' };
        }

        await yemotApi.runCampaign({
            targets: [{ phone: config.yemot.authorizedPhone, text: script.body }],
            ttsMode: true
        });

        return { placed: true };
    }

    return {
        /**
         * סורק תזכורות שהגיע זמנן ומחייג.
         * @returns {Promise<{due: number, called: number, skipped: number, exhausted: number}>}
         */
        async tick () {
            const due = repo.findDueReminders(now());
            let called = 0;
            let skipped = 0;
            let exhausted = 0;

            for (const reminder of due) {
                const log = logger.child({
                    reminderId: reminder.reminder_id,
                    callId: reminder.call_id
                });

                if (attemptsExhausted(reminder)) {
                    repo.markReminderNoAnswer(reminder.reminder_id);
                    log.event(EVENTS.REMINDER_CALL_NO_ANSWER, {
                        attempts: reminder.attempts,
                        finalStatus: 'NO_ANSWER'
                    });
                    exhausted += 1;
                    continue;
                }

                try {
                    const result = await placeCall(reminder, log);

                    if (!result.placed) {
                        skipped += 1;
                        continue;
                    }

                    repo.markReminderCalled(reminder.reminder_id);
                    log.event(EVENTS.REMINDER_CALL_STARTED, {
                        attempt: reminder.attempts + 1,
                        dueAt: reminder.due_at
                    });

                    // אין מענה מיידי: התזכורת נדחית למועד הניסיון הבא.
                    // אם המשתמש יענה ויקיש 1, השיחה תסמן אותה COMPLETED
                    // והיא לא תישלף שוב בסריקה הבאה.
                    const delayMinutes = nextRetryDelayMinutes(reminder);
                    repo.snoozeReminder(
                        reminder.reminder_id,
                        now().plus({ minutes: delayMinutes })
                    );

                    called += 1;
                } catch (error) {
                    log.failure({
                        message: 'כשל בחיוג תזכורת',
                        reminderId: reminder.reminder_id,
                        error
                    });
                    skipped += 1;
                }
            }

            return { due: due.length, called, skipped, exhausted };
        },

        /** מקש 1 בשיחה החוזרת. */
        complete (reminderId) {
            repo.markReminderCompleted(reminderId);
            logger.child({ reminderId }).event(EVENTS.REMINDER_COMPLETED, {});
        },

        /** מקשים 2 ו-3 בשיחה החוזרת (סעיף 15 באפיון). */
        snooze (reminderId, minutes) {
            const until = now().plus({ minutes });
            repo.snoozeReminder(reminderId, until);
            logger.child({ reminderId }).event(EVENTS.REMINDER_SNOOZED, {
                minutes,
                until: until.toISO()
            });
            return until;
        },

        /** שרשרת המעקב המלאה של דרישה 23, לצורכי דיבוג. */
        trace: repo.traceReminder,

        attemptsExhausted,
        nextRetryDelayMinutes
    };
}
