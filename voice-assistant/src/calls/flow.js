/**
 * זרימת השיחה הנכנסת — הלב של המערכת.
 *
 * הסדר כאן אינו שרירותי. הוא מממש את הזרימה שהאפיון מחייב (סעיף 20):
 *
 *     Audio -> Transcription -> AI parsing -> Structured data
 *           -> Human confirmation -> Action
 *
 * שתי נקודות שקל לשבור בלי לשים לב, ולכן מסומנות בקוד:
 *
 *   1. האודיו נשמר *לפני* התמלול (דרישה 6 ודרישה 12). אם Gemini נופל,
 *      אם ימות נופלת, אם Drive נופל — ההודעה של המשתמש כבר לא תאבד.
 *
 *   2. שום תזכורת לא נוצרת לפני הקשה 1 (דרישה 7). המודל מבין, ה-Backend
 *      מחשב ומאשר, והמשתמש הוא שמחליט.
 */
import { EVENTS } from '../logging/events.js';
import { logger } from '../logging/logger.js';
import { config } from '../config/index.js';
import { say, sayAll } from '../domain/speech.js';
import { confirmReminder, confirmNote, askForMissing, CONFIRM_MENU } from '../domain/confirmation.js';
import { resolveReminderTime, now } from '../domain/time.js';
import { STATUS } from '../storage/db.js';
import * as repo from '../storage/repository.js';

/** כמה פעמים מותר למשתמש להקליט מחדש באותה שיחה לפני שמסיימים בנימוס. */
const MAX_ATTEMPTS = 3;

const GREETING = 'שלום, אני מקשיב';
const RE_RECORD_PROMPT = 'בבקשה, תגיד שוב';
const SAVED_NOTE = 'הפתק נשמר';
const SAVED_REMINDER = 'התזכורת נשמרה';
const GOODBYE = 'תודה, שיהיה יום טוב';
const TOO_MANY_ATTEMPTS = 'בוא ננסה שוב מאוחר יותר, ההקלטות שלך נשמרו';
const TECHNICAL_ISSUE = 'הייתה תקלה טכנית, ההקלטה שלך נשמרה ואפשר לנסות שוב';
const UNAUTHORIZED = 'מספר זה אינו מורשה להשתמש במערכת';

/**
 * @param {object} deps מוזרקות כדי שאפשר יהיה לבדוק את הזרימה בלי רשת
 * @param {{understand: Function, name: string}} deps.ai
 * @param {{downloadFile: Function}} deps.yemotApi
 * @param {{archive: Function}} deps.archive
 * @param {{enqueueForEntry: Function}} deps.mirrors
 */
export function createCallFlow ({ ai, yemotApi, archive, mirrors }) {
    /**
     * בדיקת הרשאה בצד השרת.
     * דרישה 16: אין לסמוך רק על הגדרת ה-IVR של ימות.
     */
    function isAuthorized (phone) {
        const caller = String(phone || '').replace(/[^\d]/g, '');
        return caller === config.yemot.authorizedPhone;
    }

    /** הקלטה אחת: מבקש, מוריד, מארכב. מחזיר את האודיו ואת רשומת ההקלטה. */
    async function capture (call, log, attempt) {
        const prompt = attempt === 0 ? GREETING : RE_RECORD_PROMPT;

        log.event(EVENTS.RECORDING_STARTED, { attempt });

        const yemotPath = await call.read(sayAll(prompt), 'record', {
            path: config.yemot.recordingsPath,
            file_name: `${call.callId}-${attempt}`,
            no_confirm_menu: true,   // תפריט האישור של ימות מיותר: יש לנו אישור משלנו
            save_on_hangup: true,    // ניתוק באמצע לא ימחק את מה שכבר נאמר
            min_length: config.recording.minSeconds,
            max_length: config.recording.maxSeconds
        });

        log.event(EVENTS.RECORDING_RECEIVED, { yemotPath });

        const { recording, created } = repo.recordRecording({
            callId: call.callId,
            phone: call.phone,
            yemotPath
        });

        if (!created) {
            log.event(EVENTS.DUPLICATE_REQUEST_IGNORED, {
                recordingId: recording.recording_id,
                reason: 'אותה הקלטה כבר נרשמה'
            });
        }

        const audio = await yemotApi.downloadFile(yemotPath);
        log.event(EVENTS.RECORDING_DOWNLOADED, { bytes: audio.length });

        // >> נקודת האל-חזור של דרישה 6 <<
        // מכאן והלאה ההקלטה קיימת מחוץ לימות. כל כישלון בהמשך לא יאבד אותה.
        await archive.archive({ recording, audio });
        log.event(EVENTS.RECORDING_ARCHIVED, { recordingId: recording.recording_id });

        return { recording, audio };
    }

    /** תמלול והבנה. מפריד שגיאות מודל משגיאות אחרות כדי לתת למשתמש תשובה נכונה. */
    async function understand (audio, log) {
        log.event(EVENTS.TRANSCRIPTION_STARTED, { engine: ai.name });

        try {
            const { intent, latencyMs } = await ai.understand({ audio });

            log.event(EVENTS.TRANSCRIPTION_COMPLETED, {
                latencyMs,
                transcriptLength: intent.transcript.length
            });
            log.event(EVENTS.PARSER_COMPLETED, {
                type: intent.type,
                confidence: intent.confidence,
                needsClarification: intent.needs_clarification,
                latencyMs
            });

            // סעיף 30 באפיון: לזהות היכן צוואר הבקבוק. נרשם כשחורגים מהתקציב.
            if (latencyMs > config.responseBudgetMs) {
                log.warn('חריגה מתקציב זמן התגובה', {
                    latencyMs,
                    budgetMs: config.responseBudgetMs,
                    stage: 'ai.understand'
                });
            }

            return { ok: true, intent };
        } catch (error) {
            log.event(EVENTS.TRANSCRIPTION_FAILED, {
                engine: ai.name,
                error: error.message,
                errors: error.errors
            });
            return { ok: false, error };
        }
    }

    /**
     * הפיכת כוונה מובנת למשפט אישור.
     * מחזיר null כשחסר מידע — ואז שואלים במקום לנחש (דרישה 8).
     */
    function planAction (intent, log) {
        if (intent.type === 'note') {
            const text = intent.text || intent.transcript;
            if (!text.trim()) return { kind: 'clarify', question: askForMissing('unclear') };

            return { kind: 'note', text, sentence: confirmNote(text) };
        }

        if (intent.type === 'reminder') {
            const text = intent.text || intent.transcript;
            const reference = now();
            const resolved = resolveReminderTime(intent, reference);

            if (!resolved.ok) {
                log.event(EVENTS.CLARIFICATION_REQUESTED, {
                    reason: resolved.reason,
                    detail: resolved.detail
                });
                return { kind: 'clarify', question: askForMissing(resolved.reason, resolved.detail) };
            }

            return {
                kind: 'reminder',
                text,
                at: resolved.at,
                sentence: confirmReminder(text, resolved.at, reference)
            };
        }

        // question / unknown — בגרסה הראשונה אין מענה על שאילתות, ולכן
        // ההודעה נשמרת כפתק במקום להיאבד.
        if (intent.type === 'question') {
            const text = intent.text || intent.transcript;
            return { kind: 'note', text, sentence: confirmNote(text) };
        }

        return { kind: 'clarify', question: intent.clarification_question || askForMissing('unclear') };
    }

    /** שמירה בפועל — קורית רק אחרי הקשה 1. */
    function commit ({ call, recording, intent, plan, log }) {
        const { entry } = repo.saveEntry({
            recordingId: recording.recording_id,
            callId: call.callId,
            type: plan.kind,
            transcript: intent.transcript,
            intent,
            text: plan.text,
            status: STATUS.CONFIRMED,
            confidence: intent.confidence,
            engine: ai.name
        });

        repo.markEntryConfirmed(entry.entry_id);

        let reminder = null;
        if (plan.kind === 'reminder') {
            reminder = repo.createReminder({
                entryId: entry.entry_id,
                callId: call.callId,
                text: plan.text,
                dueAt: plan.at
            });
            log.event(EVENTS.REMINDER_CREATED, {
                reminderId: reminder.reminder_id,
                dueAt: reminder.due_at
            });
        } else {
            log.event(EVENTS.NOTE_SAVED, { entryId: entry.entry_id });
        }

        // שכבות התצוגה נכתבות אחרי שאמרנו למשתמש "נשמר", לא לפניו:
        // Drive, Sheets ו-Docs לא יעכבו שיחה בטלפון.
        mirrors.enqueueForEntry({ recording, entry, reminder, intent, plan });

        return { entry, reminder };
    }

    return async function handleCall (call) {
        const log = logger.child({ callId: call.callId, phone: call.phone });

        log.event(EVENTS.CALL_STARTED, { did: call.did, extension: call.extension });

        if (!isAuthorized(call.phone)) {
            log.event(EVENTS.CALL_REJECTED_UNAUTHORIZED, {});
            call.id_list_message(sayAll(UNAUTHORIZED));
            return;
        }

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
            let captured;
            try {
                captured = await capture(call, log, attempt);
            } catch (error) {
                log.failure({ message: 'כשל בקליטת ההקלטה', stage: 'capture', error });
                call.id_list_message(sayAll(TECHNICAL_ISSUE));
                return;
            }

            const understood = await understand(captured.audio, log);

            if (!understood.ok) {
                // התמלול נכשל אבל האודיו שמור. מבקשים לחזור, לא מאבדים.
                if (attempt < MAX_ATTEMPTS - 1) {
                    call.id_list_message(sayAll('לא הצלחתי להבין, אפשר לחזור על זה?'), { prependToNextAction: true });
                    continue;
                }
                call.id_list_message(sayAll(TECHNICAL_ISSUE));
                return;
            }

            const intent = understood.intent;

            if (intent.needs_clarification) {
                const question = intent.clarification_question || askForMissing('unclear');
                log.event(EVENTS.CLARIFICATION_REQUESTED, { question });

                if (attempt < MAX_ATTEMPTS - 1) {
                    call.id_list_message(sayAll(question), { prependToNextAction: true });
                    continue;
                }
                call.id_list_message(sayAll(TOO_MANY_ATTEMPTS));
                return;
            }

            const plan = planAction(intent, log);

            if (plan.kind === 'clarify') {
                if (attempt < MAX_ATTEMPTS - 1) {
                    call.id_list_message(sayAll(plan.question), { prependToNextAction: true });
                    continue;
                }
                call.id_list_message(sayAll(TOO_MANY_ATTEMPTS));
                return;
            }

            // reply של המודל נאמר לפני משפט האישור, ולא במקומו.
            // המשפט שמתאר מה עומד להישמר נבנה ב-Backend ולא על ידי המודל.
            log.event(EVENTS.CONFIRMATION_REQUESTED, {
                kind: plan.kind,
                sentence: plan.sentence
            });

            const choice = await call.read(
                sayAll(intent.reply, plan.sentence, CONFIRM_MENU),
                'tap',
                { max_digits: 1, digits_allowed: [1, 2], sec_wait: 10 }
            );

            if (choice === '1') {
                log.event(EVENTS.CONFIRMED, { kind: plan.kind });

                try {
                    commit({ call, recording: captured.recording, intent, plan, log });
                } catch (error) {
                    log.failure({ message: 'כשל בשמירה אחרי אישור', stage: 'commit', error });
                    call.id_list_message(sayAll(TECHNICAL_ISSUE));
                    return;
                }

                call.id_list_message(sayAll(
                    plan.kind === 'reminder' ? SAVED_REMINDER : SAVED_NOTE,
                    GOODBYE
                ));
                log.event(EVENTS.CALL_ENDED, { outcome: 'saved', kind: plan.kind });
                return;
            }

            log.event(EVENTS.RE_RECORD_REQUESTED, { attempt });
        }

        call.id_list_message(sayAll(TOO_MANY_ATTEMPTS));
        log.event(EVENTS.CALL_ENDED, { outcome: 'max_attempts' });
    };
}
