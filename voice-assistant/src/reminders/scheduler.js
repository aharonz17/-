/**
 * תזכורות ושיחות חוזרות.
 *
 * מודל ההתנהגות: **חיוג אחד, ואז המתנה.**
 *
 * תזכורת שהגיע זמנה מחייגת פעם אחת. אם המשתמש לא אישר אותה — מכל סיבה,
 * בין אם לא ענה, לא שמע או ניתק — היא עוברת לסטטוס WAITING ו**נשארת**.
 * בשיחה הנכנסת הבאה היא תושמע לו (src/calls/flow.js, תיבת התזכורות).
 *
 * העיקרון שמחזיק את זה: **לא מנסים לזהות אם המשתמש ענה.**
 * תזכורת נסגרת רק כשהוקש 1. כל מצב אחר משאיר אותה ממתינה.
 * זיהוי מענה היה מחייב קריאת סטטוס קמפיין בימות — בדיוק החלק שלא אומת —
 * והכלל הזה עובד נכון בלעדיו. הוא גם נכשל לצד הבטוח: הסיכון הוא שתזכורת
 * תושמע פעמיים, לא שתיעלם.
 *
 * ⚠ מסלול החיוג היוצא **לא אומת מול ימות** (אפיון, דרישה 2 ודרישה 28):
 *   נותר לברר כיצד מעבירים שיחת קמפיין לשלוחת API לקליטת הקשות, ומה
 *   עלות החיוג. לכן הוא כבוי כברירת מחדל ודורש
 *   REMINDERS_OUTBOUND_ENABLED=true. כשהוא כבוי התזכורות עדיין נוצרות,
 *   מתוזמנות, נרשמות בלוג ועוברות ל-WAITING — כלומר **תיבת התזכורות
 *   עובדת גם בלי חיוג יוצא כלל.** זו הסיבה שהיא נבנתה על המסלול הנכנס.
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
         * @returns {Promise<{due: number, called: number, skipped: number, waiting: number}>}
         */
        async tick () {
            const due = repo.findDueReminders(now());
            let called = 0;
            let skipped = 0;
            let waiting = 0;

            for (const reminder of due) {
                const log = logger.child({
                    reminderId: reminder.reminder_id,
                    callId: reminder.call_id
                });

                // הגנה על רשומות שנוצרו במדיניות ישנה: תזכורת שכבר מיצתה
                // את מכסת הניסיונות עוברת להמתנה, לא נסגרת.
                if (attemptsExhausted(reminder)) {
                    repo.markReminderWaiting(reminder.reminder_id);
                    log.event(EVENTS.REMINDER_WAITING, {
                        attempts: reminder.attempts,
                        reason: 'מכסת הניסיונות מוצתה'
                    });
                    waiting += 1;
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
                    called += 1;

                    // אם המשתמש ענה והקיש 1, השיחה כבר סימנה COMPLETED
                    // והעדכון כאן לא יחזיר אותה לתור — findWaitingReminders
                    // ו-findDueReminders שניהם מסננים לפי סטטוס.
                    if (reminder.attempts + 1 >= config.reminders.retryCount) {
                        repo.markReminderWaiting(reminder.reminder_id);
                        log.event(EVENTS.REMINDER_WAITING, {
                            attempts: reminder.attempts + 1,
                            reason: 'חויג ולא אושר, ממתין לשיחה נכנסת'
                        });
                        waiting += 1;
                    } else {
                        // מדיניות של יותר מניסיון אחד: תזמון חוזר ששומר
                        // על attempts. חובה שלא להשתמש כאן ב-snoozeReminder,
                        // שמאפס אותו ויוצר לולאת חיוג.
                        repo.rescheduleReminderForRetry(
                            reminder.reminder_id,
                            now().plus({ minutes: nextRetryDelayMinutes(reminder) })
                        );
                    }
                } catch (error) {
                    log.failure({
                        message: 'כשל בחיוג תזכורת',
                        reminderId: reminder.reminder_id,
                        error
                    });
                    skipped += 1;
                }
            }

            return { due: due.length, called, skipped, waiting };
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
