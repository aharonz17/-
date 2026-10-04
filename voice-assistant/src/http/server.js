/**
 * שרת ה-HTTP שימות פונה אליו.
 *
 * הגנה בשתי שכבות, כי אף אחת מהן לא מספיקה לבדה:
 *
 *   1. סוד משותף ב-URL. כתובת ה-webhook היא ציבורית מעצם טבעה, וכל מי
 *      שמגלה אותה יכול לזייף שיחה. ימות מצרפת את הסוד כפרמטר, והבקשה
 *      נדחית בלעדיו — לפני שהיא מגיעה לקוד השיחה בכלל.
 *
 *   2. בדיקת מספר מורשה בצד השרת (דרישה 16), שקורית בתוך זרימת השיחה.
 *      caller ID ניתן לזיוף, ולכן זו הגבלה ולא אימות — אבל היא הכרחית.
 */
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { YemotRouter } from 'yemot-router2';
import { config } from '../config/index.js';
import { logger } from '../logging/logger.js';
import { EVENTS } from '../logging/events.js';
import { sayAll } from '../domain/speech.js';

/** השוואה בזמן קבוע, כדי לא לדלוף את הסוד דרך זמני תגובה. */
function secretMatches (provided) {
    const expected = config.webhookSecret;
    if (!provided || provided.length !== expected.length) return false;

    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function createServer ({ handleCall, mirrors }) {
    const app = express();

    app.disable('x-powered-by');
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timezone: config.timezone, engine: config.activeTranscriber });
    });

    app.use('/yemot', (req, res, next) => {
        const provided = req.query.secret || req.body?.secret;

        if (!secretMatches(provided)) {
            logger.warn('בקשה ל-webhook בלי סוד תקין', {
                ip: req.ip,
                hasSecret: Boolean(provided)
            });
            res.status(403).send('forbidden');
            return;
        }
        next();
    });

    const router = YemotRouter({
        timeout: 10 * 60 * 1000,
        printLog: !config.isProduction,

        /**
         * בלי המטפל הזה, חריגה בתוך שיחה מפילה את הבקשה והמשתמש שומע
         * "אין מענה משרת API" בלי שנדע למה. כאן זה נרשם ונאמר לו משהו אנושי.
         */
        uncaughtErrorHandler (error, call) {
            logger.child({ callId: call?.callId, phone: call?.phone })
                .failure({ message: 'חריגה לא מטופלת בשיחה', error });

            try {
                call.id_list_message(sayAll('הייתה תקלה טכנית, ההקלטה שלך נשמרה'));
            } catch {
                // השיחה כבר נותקה — אין מה לעשות מעבר לרישום שכבר בוצע
            }
        },

        defaults: {
            // רשת ביטחון: התווים  . - " ' &  פסולים בהקראת טקסט בימות.
            // הטקסט כבר מנוקה ב-src/domain/speech.js, וזו שכבה שנייה
            // שלא תפיל שיחה על מקרה שלא חשבנו עליו.
            removeInvalidChars: true
        }
    });

    router.all('/', handleCall);

    router.events.on('call_hangup', (call) => {
        logger.child({ callId: call.callId }).event(EVENTS.CALL_ENDED, { outcome: 'hangup' });
    });

    app.use('/yemot', router.asExpressRouter);

    /**
     * ריקון תור התצוגה בדחיפה חיצונית (Cloud Scheduler / cron).
     * מוגן באותו סוד.
     */
    app.post('/tasks/flush-mirrors', async (req, res) => {
        if (!secretMatches(req.query.secret || req.body?.secret)) {
            res.status(403).send('forbidden');
            return;
        }

        try {
            const result = await mirrors.flush();
            res.json(result);
        } catch (error) {
            logger.failure({ message: 'כשל בריקון תור התצוגה', error });
            res.status(500).json({ error: error.message });
        }
    });

    app.use((req, res) => res.status(404).send('not found'));

    return app;
}
