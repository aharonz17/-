#!/usr/bin/env node
/**
 * בדיקת מוכנות אמיתית — לא בדיקה שההגדרות "נראות בסדר", אלא קריאה בפועל
 * לכל שירות חיצוני.
 *
 * אפיון, דרישה 27: בסיום כל שלב יש לדווח מה באמת עובד, מה לא, ומה לא נבדק.
 * הכלי הזה עונה על השאלה הזו במקום לנחש.
 *
 *   npm run check-config
 */
import { config, getConfigProblems } from '../src/config/index.js';
import { createYemotApi } from '../src/voice/yemot-api.js';
import { createDriveWriter } from '../src/storage/drive.js';
import { createSheetsWriter } from '../src/storage/sheets.js';
import { createDocsWriter } from '../src/storage/docs.js';
import { createProvider } from '../src/ai/index.js';
import { now } from '../src/domain/time.js';

const results = [];

async function check (name, fn, { required = true } = {}) {
    process.stdout.write(`  … ${name}`);
    try {
        const detail = await fn();
        process.stdout.write(`\r  ✓ ${name}${detail ? ` — ${detail}` : ''}\n`);
        results.push({ name, status: 'ok', required });
    } catch (error) {
        process.stdout.write(`\r  ✗ ${name} — ${error.message}\n`);
        results.push({ name, status: 'failed', required, error: error.message });
    }
}

function skip (name, reason) {
    console.log(`  – ${name} — לא נבדק (${reason})`);
    results.push({ name, status: 'skipped', reason });
}

async function main () {
    console.log('\nבדיקת מוכנות\n' + '─'.repeat(60));

    const problems = getConfigProblems();

    console.log('\nהגדרות');
    if (problems.missing.length > 0) {
        for (const item of problems.missing) console.log(`  ✗ חסר: ${item}`);
    } else {
        console.log('  ✓ כל הגדרות החובה קיימות');
    }
    for (const warning of problems.warnings) console.log(`  ⚠ ${warning}`);

    console.log('\nימות המשיח');
    if (!config.yemot.token) {
        skip('חיבור לימות', 'YEMOT_TOKEN חסר');
    } else {
        const yemot = createYemotApi();
        await check('טוקן תקף', async () => {
            const result = await yemot.verifyToken();
            return result.hasSessionToken
                ? 'ההזדהות התקבלה והתקבל טוקן סשן'
                : 'ההזדהות התקבלה';
        });
    }

    console.log('\nמנוע ההבנה');
    if (!config.google.geminiApiKey) {
        skip('Gemini', 'GEMINI_API_KEY חסר');
    } else {
        await check(`Gemini (${config.google.geminiModel})`, async () => {
            const provider = createProvider('gemini');
            // קובץ WAV מינימלי ותקין: כותרת בלבד, בלי דגימות.
            // מספיק כדי לאמת מפתח, הרשאות ותקשורת — בלי לשרוף מכסה.
            const header = Buffer.alloc(44);
            header.write('RIFF', 0); header.writeUInt32LE(36, 4); header.write('WAVE', 8);
            header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
            header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28);
            header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
            header.write('data', 36); header.writeUInt32LE(0, 40);

            await provider.understand({ audio: header, mimeType: 'audio/wav', timeoutMs: 30000 });
            return 'המודל עונה';
        });
    }

    console.log('\nGoogle');
    if (!config.google.driveFolderId) skip('Drive', 'GOOGLE_DRIVE_FOLDER_ID חסר');
    else await check('Drive — תיקייה והרשאת כתיבה', async () => {
        const info = await createDriveWriter().verifyAccess();
        if (!info.capabilities?.canAddChildren) throw new Error('אין הרשאת כתיבה לתיקייה');
        return info.name;
    });

    if (!config.google.sheetId) skip('Sheets', 'GOOGLE_SHEET_ID חסר');
    else await check('Sheets — גיליון וכותרות', async () => {
        await createSheetsWriter().ensureSheet();
        return 'הלשונית מוכנה';
    });

    if (!config.google.docsFolderId) skip('Docs', 'GOOGLE_DOCS_FOLDER_ID חסר');
    else await check('Docs — מסמך החודש', async () => {
        const info = await createDocsWriter().verifyAccess(now());
        return info.title;
    });

    console.log('\n' + '─'.repeat(60));

    const failed = results.filter((r) => r.status === 'failed');
    const skipped = results.filter((r) => r.status === 'skipped');
    const ok = results.filter((r) => r.status === 'ok');

    console.log(`עובד: ${ok.length}   |   נכשל: ${failed.length}   |   לא נבדק: ${skipped.length}\n`);

    if (failed.length > 0) {
        console.log('לא עובד:');
        for (const item of failed) console.log(`  • ${item.name}: ${item.error}`);
        console.log('');
    }

    if (skipped.length > 0) {
        console.log('לא נבדק:');
        for (const item of skipped) console.log(`  • ${item.name} (${item.reason})`);
        console.log('');
    }

    console.log(
        'שים לב: גם כשהכול ירוק כאן, הזרימה בשיחה אמיתית עדיין לא נבדקה.\n' +
        'הבדיקה האמיתית היא להתקשר למספר ולעבור את התרחיש מקצה לקצה.\n'
    );

    process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
    console.error(`\nכשל בבדיקה: ${error.message}\n`);
    process.exitCode = 1;
});
