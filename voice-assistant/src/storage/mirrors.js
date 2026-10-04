/**
 * תור הכתיבה לשכבות התצוגה: Drive, Sheets, Docs.
 *
 * למה תור ולא כתיבה ישירה — שתי סיבות מהאפיון:
 *
 *   דרישה 12: "אם Google Drive נכשל, המערכת לא מאבדת את ההודעה. צריך
 *   להיות מנגנון Retry ו-Error Handling." הרשומה כבר ב-SQLite; התור
 *   דואג שהיא תגיע גם לשכבות התצוגה, גם אם מאוחר יותר.
 *
 *   סעיף 30 (ביצועים): המשתמש לא צריך לחכות בטלפון בזמן שכותבים ל-Docs.
 *   השמירה מאושרת לו מיד, והכתיבות האלה קורות אחריה.
 */
import { logger } from '../logging/logger.js';
import { EVENTS } from '../logging/events.js';
import { MIRROR_TARGETS } from './archive.js';
import { createDriveWriter } from './drive.js';
import { createSheetsWriter } from './sheets.js';
import { createDocsWriter } from './docs.js';
import { fromStorage } from '../domain/time.js';
import * as repo from './repository.js';

export function createMirrors ({
    drive = createDriveWriter(),
    sheets = createSheetsWriter(),
    docs = createDocsWriter()
} = {}) {
    /**
     * מוסיף את משימות התצוגה של רשומה שאושרה.
     * מפתח ה-idempotency נגזר מ-entry_id, כך שעיבוד כפול של התור
     * לא ייצור שורה כפולה ב-Sheet או ב-Docs (דרישה 19).
     */
    function enqueueForEntry ({ recording, entry, reminder }) {
        const payload = {
            entryId: entry.entry_id,
            recordingId: recording.recording_id,
            reminderId: reminder?.reminder_id || null
        };

        for (const target of [MIRROR_TARGETS.SHEETS, MIRROR_TARGETS.DOCS]) {
            const queued = repo.enqueueMirrorWrite({
                target,
                payload,
                idempotencyKey: entry.entry_id
            });

            if (queued) {
                logger.child({ entryId: entry.entry_id })
                    .event(EVENTS.MIRROR_WRITE_QUEUED, { target });
            }
        }
    }

    /** מבצע משימה בודדת מהתור. */
    async function execute (job) {
        const payload = JSON.parse(job.payload);

        if (job.target === MIRROR_TARGETS.DRIVE) {
            const { fileId, link } = await drive.uploadRecording(payload);
            repo.attachRecordingArtifacts(payload.recordingId, { driveFileId: fileId, driveLink: link });
            return { fileId };
        }

        const entry = repo.getEntry(payload.entryId);
        if (!entry) throw new Error(`רשומה ${payload.entryId} לא נמצאה`);

        const recording = repo.getRecording(entry.recording_id);
        const reminder = payload.reminderId ? repo.getReminder(payload.reminderId) : null;

        if (job.target === MIRROR_TARGETS.SHEETS) {
            await sheets.appendEntry({ entry, recording, reminder });
            return {};
        }

        if (job.target === MIRROR_TARGETS.DOCS) {
            // קישור ההקלטה נלקח מ-Drive. אם העלאת ה-Drive עדיין בתור,
            // הקישור יהיה ריק — ולכן משימת ה-Docs נשארת בתור וננסה שוב
            // אחרי שה-Drive הושלם, במקום לכתוב שורה בלי קישור.
            if (!recording?.drive_link) {
                throw new Error('ממתין להשלמת העלאת ההקלטה ל-Drive');
            }

            await docs.appendEntry({
                at: fromStorage(entry.created_at),
                type: entry.type,
                text: entry.text || entry.transcript || '',
                recordingLink: recording.drive_link,
                suffix: reminder
                    ? `(תזכורת ל-${fromStorage(reminder.due_at).toFormat('dd/MM HH:mm')})`
                    : ''
            });
            return {};
        }

        throw new Error(`יעד לא מוכר: ${job.target}`);
    }

    return {
        enqueueForEntry,

        /**
         * מרוקן את התור. נקרא מתזמון תקופתי ובעליית השרת.
         * @returns {Promise<{processed: number, failed: number}>}
         */
        async flush ({ limit = 20 } = {}) {
            const jobs = repo.claimPendingMirrorWrites({ limit });
            let processed = 0;
            let failed = 0;

            for (const job of jobs) {
                const log = logger.child({ queueId: job.queue_id, target: job.target });

                try {
                    await execute(job);
                    repo.markMirrorWriteCompleted(job.queue_id);
                    log.event(EVENTS.MIRROR_WRITE_COMPLETED, {});
                    processed += 1;
                } catch (error) {
                    repo.markMirrorWriteFailed(job.queue_id, error.message);
                    log.event(EVENTS.MIRROR_WRITE_FAILED, {
                        error: error.message,
                        attempts: job.attempts + 1
                    });
                    failed += 1;
                }
            }

            return { processed, failed };
        },

        execute
    };
}
