/**
 * רתמת המדידה של שלב 0.
 *
 * למה זה נבנה לפני ה-POC ולא אחריו: שווי המערכת כולה תלוי בדיוק תמלול
 * עברית על קו טלפון ב-8 קילוהרץ. אם הדיוק נמוך, שום איכות קוד לא תציל
 * את המוצר — ועדיף לגלות את זה בשבוע הראשון ולא אחרי שנבנתה מערכת שלמה.
 *
 * אפיון, דרישה 5: הבדיקה חייבת להיות בקול האמיתי של המשתמש, לפחות 30–50
 * הודעות. אין כאן יצירת אודיו סינתטי בכוונה — ההרצה דורשת קבצים אמיתיים
 * ונכשלת בלעדיהם, במקום לייצר מספרים חסרי משמעות.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { wordErrorRate, semanticMatch, mean, median } from './metrics.js';

const MIME_BY_EXTENSION = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4'
};

export function mimeTypeFor (filePath) {
    const mime = MIME_BY_EXTENSION[extname(filePath).toLowerCase()];
    if (!mime) {
        throw new Error(`סיומת קובץ לא נתמכת: ${filePath}`);
    }
    return mime;
}

/**
 * טוען את קובץ האמת ומוודא שהקבצים באמת קיימים לפני שמתחילים לשרוף
 * קריאות API על רשימה שגויה.
 */
export function loadGroundTruth (groundTruthPath, recordingsDir) {
    if (!existsSync(groundTruthPath)) {
        throw new Error(
            `קובץ האמת לא נמצא: ${groundTruthPath}\n` +
            'צור אותו לפי benchmark/ground-truth.example.json'
        );
    }

    let entries;
    try {
        entries = JSON.parse(readFileSync(groundTruthPath, 'utf8'));
    } catch (error) {
        throw new Error(`קובץ האמת אינו JSON תקין: ${error.message}`);
    }

    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error('קובץ האמת ריק. נדרשות לפחות 30 הקלטות אמיתיות (אפיון, דרישה 5)');
    }

    const problems = [];
    const resolved = entries.map((entry, index) => {
        if (!entry.file) {
            problems.push(`רשומה ${index}: חסר שדה file`);
            return null;
        }
        if (typeof entry.transcript !== 'string') {
            problems.push(`רשומה ${index} (${entry.file}): חסר transcript`);
            return null;
        }

        const audioPath = resolve(recordingsDir, entry.file);
        if (!existsSync(audioPath)) {
            problems.push(`רשומה ${index}: הקובץ לא קיים — ${audioPath}`);
            return null;
        }
        return { ...entry, audioPath };
    });

    if (problems.length > 0) {
        throw new Error(`בעיות בקובץ האמת:\n  - ${problems.join('\n  - ')}`);
    }

    return resolved;
}

/**
 * מריץ מנוע אחד על כל ההקלטות.
 * כשלון על קובץ בודד נרשם ולא מפיל את ההרצה — מנוע שנכשל ב-3 מתוך 40
 * הוא מידע חשוב בפני עצמו, ולא סיבה לאבד את 37 האחרים.
 */
export async function runEngine (provider, entries, { onProgress } = {}) {
    const results = [];

    for (const [index, entry] of entries.entries()) {
        const audio = readFileSync(entry.audioPath);
        const mimeType = mimeTypeFor(entry.audioPath);

        const result = {
            file: entry.file,
            expected: entry,
            transcript: null,
            intent: null,
            wer: null,
            semantic: null,
            latencyMs: null,
            error: null
        };

        try {
            if (typeof provider.understand === 'function') {
                const { intent, latencyMs } = await provider.understand({ audio, mimeType });
                result.transcript = intent.transcript;
                result.intent = intent;
                result.latencyMs = latencyMs;
                result.semantic = semanticMatch(entry, intent);
            } else {
                const { transcript, latencyMs } = await provider.transcribeOnly({ audio, mimeType });
                result.transcript = transcript;
                result.latencyMs = latencyMs;
            }

            result.wer = wordErrorRate(entry.transcript, result.transcript);
        } catch (error) {
            result.error = error.message;
        }

        results.push(result);
        onProgress?.({ index: index + 1, total: entries.length, result });
    }

    return summarize(provider.name, results);
}

function summarize (engineName, results) {
    const succeeded = results.filter((result) => result.error === null);
    const failed = results.filter((result) => result.error !== null);

    const wers = succeeded.map((result) => result.wer);
    const latencies = succeeded.map((result) => result.latencyMs);

    const withSemantics = succeeded.filter((result) => result.semantic !== null);
    const semanticPassed = withSemantics.filter((result) => result.semantic.allPassed);

    const countField = (field) => {
        const relevant = withSemantics.filter((result) => result.semantic.checks[field] !== undefined);
        if (relevant.length === 0) return null;
        const passed = relevant.filter((result) => result.semantic.checks[field]).length;
        return { passed, total: relevant.length, rate: passed / relevant.length };
    };

    return {
        engine: engineName,
        total: results.length,
        succeeded: succeeded.length,
        failed: failed.length,
        errors: failed.map((result) => ({ file: result.file, error: result.error })),
        wer: { mean: mean(wers), median: median(wers) },
        latencyMs: { mean: Math.round(mean(latencies)), median: Math.round(median(latencies)) },
        semantic: withSemantics.length > 0
            ? {
                passed: semanticPassed.length,
                total: withSemantics.length,
                rate: semanticPassed.length / withSemantics.length,
                type: countField('type'),
                date: countField('date'),
                time: countField('time'),
                text: countField('text')
            }
            : null,
        results
    };
}
