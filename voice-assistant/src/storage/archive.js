/**
 * שמירת האודיו המקורי.
 *
 * אפיון, דרישה 6: "כל הודעה שהוקלטה חייבת להישמר באודיו המקורי. גם אם
 * התמלול נכשל, ה-AI נכשל, Google API נכשל, המשתמש ביקש הקלטה מחדש,
 * או הייתה שגיאה אחרת."
 *
 * לכן השמירה כאן דו-שלבית ולא תלויה ברשת:
 *   1. דיסק מקומי — סינכרוני, מיידי, בלי תלות חיצונית. זה מה שמבטיח שהאודיו קיים.
 *   2. Drive — נכנס לתור ומטופל ברקע. אם Drive נופל, האודיו עדיין אצלנו.
 *
 * הערה על Cloud Run: הדיסק המקומי הוא זמני ונמחק עם המופע. השלב המקומי
 * מגן מפני כישלון של Drive בתוך אותה שיחה, לא מפני אובדן לטווח ארוך.
 * לכן תור ה-Drive חייב להתרוקן, ו-bin/flush-mirrors.js קיים בדיוק לזה.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../logging/logger.js';
import { EVENTS } from '../logging/events.js';
import { fromStorage } from '../domain/time.js';
import * as repo from './repository.js';

export const MIRROR_TARGETS = Object.freeze({
    DRIVE: 'drive',
    SHEETS: 'sheets',
    DOCS: 'docs'
});

/** ivr2:/1/000.wav -> wav */
function extensionOf (yemotPath) {
    const match = /\.([a-z0-9]{2,5})$/i.exec(yemotPath || '');
    return match ? match[1].toLowerCase() : 'wav';
}

/**
 * שם קובץ לפי תאריך ושעה, כמו בסעיף 10 באפיון:
 * 2026-09-17_10-32-14.wav, בתוך היררכיית שנה/חודש.
 */
export function archivePathFor (recording) {
    const createdAt = fromStorage(recording.created_at);
    const stamp = createdAt.toFormat('yyyy-MM-dd_HH-mm-ss');
    const extension = extensionOf(recording.yemot_path);

    return {
        year: createdAt.toFormat('yyyy'),
        month: createdAt.toFormat('MM'),
        fileName: `${stamp}_${recording.recording_id.slice(0, 8)}.${extension}`
    };
}

export function createArchive () {
    const root = resolve(config.projectRoot, 'data/recordings');

    return {
        /**
         * @param {{recording: object, audio: Buffer}} input
         * @returns {Promise<{localPath: string}>}
         */
        async archive ({ recording, audio }) {
            const { year, month, fileName } = archivePathFor(recording);
            const localPath = resolve(root, year, month, fileName);

            // סינכרוני בכוונה: רוצים שהכתיבה תושלם לפני שממשיכים,
            // ולא שתיתלה בתור של event loop בזמן שהעיבוד מתקדם.
            mkdirSync(dirname(localPath), { recursive: true });
            writeFileSync(localPath, audio);

            repo.attachRecordingArtifacts(recording.recording_id, {
                localPath,
                bytes: audio.length
            });

            const queued = repo.enqueueMirrorWrite({
                target: MIRROR_TARGETS.DRIVE,
                payload: { recordingId: recording.recording_id, localPath, fileName, year, month },
                idempotencyKey: recording.recording_id
            });

            if (queued) {
                logger.child({ recordingId: recording.recording_id })
                    .event(EVENTS.MIRROR_WRITE_QUEUED, { target: MIRROR_TARGETS.DRIVE, fileName });
            }

            return { localPath };
        },

        root
    };
}
