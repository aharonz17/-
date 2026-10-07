/**
 * שרת ה-HTTP שימות פונה אליו.
 *
 * הגנה בשתי שכבות, כי אף אחת מהן לא מספיקה לבדה:
 *
 *   1. סוד משותף ב-URL. כתובת ה-webhook היא ציבורית מעצם טבעה, וכל מי
 *      שמגלה אותה יכול לזייף שיחה. הסוד הוא חלק מהנתיב (/yemot/<סוד>), והבקשה
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
    if (typeof provided !== 'string' || provided.length !== expected.length) return false;

    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * הסוד מגיע בנתיב: /yemot/<סוד>. זו הצורה המומלצת, כי ימות מוסיפה פרמטרים
 * משלה לכתובת, ופרמטר שלנו ב-query לא שרד את זה בשיחה אמיתית (07/10/2026:
 * הבקשות הגיעו לשרת ונדחו על סוד, עם קישור שהסוד בו שלם). בנתיב אין לה
 * מה לגעת. הצורה הישנה, ?secret=, עדיין נתמכת.
 */
function providedSecret (req) {
    if (req.params?.secret) return req.params.secret;
    const fromQuery = req.query.secret ?? req.body?.secret;
    return Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
}

/** מה הגיע, בלי לחשוף את הסוד עצמו — כדי שדחייה תהיה ניתנת לאבחון מהלוג. */
function describeRejected (req, provided) {
    const raw = req.query.secret ?? req.body?.secret;
    return {
        method: req.method,
        hasSecret: Boolean(provided),
        secretLength: typeof provided === 'string' ? provided.length : null,
        expectedLength: config.webhookSecret.length,
        secretIsArray: Array.isArray(raw),
        params: Object.keys(req.query).concat(Object.keys(req.body || {})).join(',')
    };
}

export function createServer ({ handleCall, mirrors }) {
    const app = express();

    app.disable('x-powered-by');
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timezone: config.timezone, engine: config.activeTranscriber });
    });

    function requireSecret (req, res, next) {
        const provided = providedSecret(req);

        if (!secretMatches(provided)) {
            logger.warn('בקשה ל-webhook בלי סוד תקין', describeRejected(req, provided));
            res.status(403).send('forbidden');
            return;
        }
        next();
    }

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

    // הסדר חשוב: הנתיב עם הסוד קודם, אחרת /yemot/<סוד> ייתפס כ-/yemot בלי סוד
    app.use('/yemot/:secret', requireSecret, router.asExpressRouter);
    app.use('/yemot', requireSecret, router.asExpressRouter);

    /**
     * ריקון תור התצוגה בדחיפה חיצונית (Cloud Scheduler / cron).
     * מוגן באותו סוד.
     */
    app.post('/tasks/flush-mirrors', async (req, res) => {
        if (!secretMatches(providedSecret(req))) {
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

    app.use((req, res) => {
        // בלי זה, קישור עם טעות בנתיב נכשל בשקט ולא משאיר שום סימן בלוג.
        // הנתיב נרשם בלי הסוד.
        logger.warn('בקשה לנתיב לא קיים', {
            method: req.method,
            path: req.path.replace(/^\/yemot\/[^/]+/, '/yemot/<secret>')
        });
        res.status(404).send('not found');
    });

    return app;
}
