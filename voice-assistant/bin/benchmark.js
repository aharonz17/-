#!/usr/bin/env node
/**
 * שלב 0 — השוואת מנועי תמלול על הקלטות טלפון אמיתיות.
 *
 *   npm run benchmark
 *   npm run benchmark -- --engines gemini,google-stt
 *   npm run benchmark -- --ground-truth benchmark/my-truth.json
 *
 * ההרצה דורשת קבצי אודיו אמיתיים ונכשלת בלעדיהם, במכוון.
 * אפיון, "מה לא לעשות": אין לבנות Demo שמתחזה למערכת עובדת.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../src/config/index.js';
import { createProvider, AVAILABLE_PROVIDERS } from '../src/ai/index.js';
import { loadGroundTruth, runEngine } from '../src/benchmark/runner.js';
import { percent } from '../src/benchmark/metrics.js';

function parseArgs (argv) {
    const args = { engines: AVAILABLE_PROVIDERS, groundTruth: 'benchmark/ground-truth.json', recordings: 'benchmark/recordings' };

    for (let i = 0; i < argv.length; i += 1) {
        const [flag, inlineValue] = argv[i].split('=');
        const value = inlineValue ?? argv[++i];

        if (flag === '--engines') args.engines = value.split(',').map((name) => name.trim());
        else if (flag === '--ground-truth') args.groundTruth = value;
        else if (flag === '--recordings') args.recordings = value;
    }
    return args;
}

function formatRow (summary) {
    const semantic = summary.semantic;
    return [
        summary.engine.padEnd(22),
        percent(summary.wer.median).padStart(8),
        percent(summary.wer.mean).padStart(8),
        (semantic ? percent(semantic.rate) : '—').padStart(10),
        (semantic?.time ? percent(semantic.time.rate) : '—').padStart(8),
        (semantic?.date ? percent(semantic.date.rate) : '—').padStart(8),
        `${summary.latencyMs.median}ms`.padStart(9),
        `${summary.failed}`.padStart(7)
    ].join(' ');
}

async function main () {
    const args = parseArgs(process.argv.slice(2));

    const groundTruthPath = resolve(config.projectRoot, args.groundTruth);
    const recordingsDir = resolve(config.projectRoot, args.recordings);

    const entries = loadGroundTruth(groundTruthPath, recordingsDir);

    console.log(`\nנטענו ${entries.length} הקלטות מתוך ${recordingsDir}`);

    if (entries.length < 30) {
        console.log(
            `\n⚠  יש רק ${entries.length} הקלטות. האפיון (דרישה 5) דורש לפחות 30–50\n` +
            '   כדי שהתוצאה תהיה בעלת משמעות סטטיסטית. ההרצה תימשך, אבל אל תקבל\n' +
            '   החלטת מנוע על בסיס מדגם קטן מזה.'
        );
    }

    const summaries = [];

    for (const engineName of args.engines) {
        let provider;
        try {
            provider = createProvider(engineName);
        } catch (error) {
            console.log(`\n✗ ${engineName}: לא ניתן לאתחל — ${error.message}`);
            continue;
        }

        console.log(`\n▶ ${provider.name}`);

        const summary = await runEngine(provider, entries, {
            onProgress ({ index, total, result }) {
                const status = result.error ? '✗' : '✓';
                const detail = result.error ? result.error.slice(0, 60) : `WER ${percent(result.wer)}`;
                process.stdout.write(`  ${status} [${index}/${total}] ${result.file} — ${detail}\n`);
            }
        });

        summaries.push(summary);
    }

    if (summaries.length === 0) {
        console.log('\nאף מנוע לא רץ. בדוק הגדרות ב-.env');
        process.exitCode = 1;
        return;
    }

    console.log('\n' + '='.repeat(88));
    console.log('מנוע                        WER חציון  WER ממוצע   סמנטי    שעה     תאריך   השהיה   כשלים');
    console.log('='.repeat(88));
    for (const summary of summaries) console.log(formatRow(summary));
    console.log('='.repeat(88));

    console.log(
        '\nהמדד הקובע הוא "סמנטי", לא WER (אפיון, סעיף 24).\n' +
        'מילה שתומללה מעט שונה אינה שגיאה. שעה שהובנה 10:00 במקום 22:00 — כן.\n'
    );

    const resultsDir = resolve(config.projectRoot, 'benchmark/results');
    mkdirSync(resultsDir, { recursive: true });

    const outputPath = resolve(resultsDir, `benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(outputPath, JSON.stringify({ ranAt: new Date().toISOString(), entries: entries.length, summaries }, null, 2));

    console.log(`התוצאות המלאות נשמרו ב-${outputPath}\n`);
}

main().catch((error) => {
    console.error(`\n✗ ${error.message}\n`);
    process.exitCode = 1;
});
