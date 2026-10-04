/**
 * נקודת הכניסה.
 *
 * סדר האתחול מכוון: ההגדרות נבדקות לפני שמשהו מתחבר לרשת, כדי ששגיאת
 * הגדרה תיפול בעלייה ולא באמצע שיחה אמיתית.
 */
import { config, assertConfigValid, getConfigProblems } from './config/index.js';
import { logger } from './logging/logger.js';
import { createServer } from './http/server.js';
import { createCallFlow } from './calls/flow.js';
import { createActiveUnderstandingProvider } from './ai/index.js';
import { createYemotApi } from './voice/yemot-api.js';
import { createArchive } from './storage/archive.js';
import { createMirrors } from './storage/mirrors.js';
import { getDb, closeDb } from './storage/db.js';

/** כל דקה. ריקון התור הוא זול כשהתור ריק. */
const MIRROR_FLUSH_INTERVAL_MS = 60 * 1000;

async function main () {
    assertConfigValid();

    for (const warning of getConfigProblems().warnings) {
        logger.warn('אזהרת הגדרות', { warning });
    }

    getDb();

    const ai = createActiveUnderstandingProvider();
    const yemotApi = createYemotApi();
    const archive = createArchive();
    const mirrors = createMirrors();

    const handleCall = createCallFlow({ ai, yemotApi, archive, mirrors });
    const app = createServer({ handleCall, mirrors });

    const server = app.listen(config.port, () => {
        logger.info('השרת עלה', {
            port: config.port,
            env: config.env,
            engine: ai.name,
            timezone: config.timezone,
            webhookPath: '/yemot'
        });
    });

    // ריקון ראשוני: משימות שנותרו מהרצה קודמת מטופלות מיד עם העלייה,
    // ולא ממתינות למחזור הבא.
    mirrors.flush().then(({ processed, failed }) => {
        if (processed || failed) logger.info('ריקון תור ראשוני', { processed, failed });
    }).catch((error) => logger.failure({ message: 'כשל בריקון תור ראשוני', error }));

    const flushTimer = setInterval(() => {
        mirrors.flush().catch((error) => logger.failure({ message: 'כשל בריקון תור', error }));
    }, MIRROR_FLUSH_INTERVAL_MS);

    flushTimer.unref();

    const shutdown = (signal) => {
        logger.info('סגירה מסודרת', { signal });
        clearInterval(flushTimer);
        server.close(() => {
            closeDb();
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
    logger.failure({ message: 'כשל בעליית השרת', error });
    process.exitCode = 1;
});
