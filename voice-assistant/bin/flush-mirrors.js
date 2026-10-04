#!/usr/bin/env node
/**
 * ריקון ידני של תור הכתיבה ל-Drive / Sheets / Docs.
 *
 * שימושי כשהשרת היה למטה והצטברו משימות, או לאחר תיקון הרשאות ב-Google.
 * השרת מריץ את זה גם לבדו כל דקה — זה כאן לשליטה ידנית ולדיבוג.
 */
import { createMirrors } from '../src/storage/mirrors.js';
import { getDb, closeDb } from '../src/storage/db.js';

async function main () {
    getDb();
    const mirrors = createMirrors();

    let totalProcessed = 0;
    let totalFailed = 0;

    // ממשיכים כל עוד יש התקדמות, כדי ש-Docs שהמתין ל-Drive יתפוס
    // את התור באותה הרצה ולא בהרצה הבאה.
    for (let round = 0; round < 10; round += 1) {
        const { processed, failed } = await mirrors.flush({ limit: 50 });
        totalProcessed += processed;
        totalFailed += failed;
        if (processed === 0) break;
    }

    console.log(`הושלמו: ${totalProcessed}   |   נכשלו: ${totalFailed}`);
    closeDb();
    process.exitCode = totalFailed > 0 ? 1 : 0;
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
