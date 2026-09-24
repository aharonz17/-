/**
 * לקוח ל-REST API של ימות המשיח.
 *
 * מה אומת מול התיעוד של ימות ומול המימוש של yemot-router2:
 *   - בסיס:        https://www.call2all.co.il/ym/api
 *   - טוקן:        <מספר-מערכת>:<סיסמה>, מועבר כפרמטר token
 *   - DownloadFile: ?token=...&path=ivr2:/1/000.wav   מחזיר את הקובץ עצמו
 *   - תשובות JSON: כוללות responseStatus = OK | ERROR | FORBIDDEN | EXCEPTION
 *
 * מה *לא* אומת ומסומן ככזה בקוד: התנהגות החיוג היוצא המדויקת.
 * אפיון, דרישה 2: אסור להמציא API או פרמטרים. לכן כל קריאה יוצאת עוברת
 * דרך request() שמחזיר את תשובת ימות כמות שהיא, ואין כאן שום פרמטר
 * שלא מופיע בתיעוד.
 *
 * ── שני סוגי טוקנים ───────────────────────────────────────────────────
 *
 * נבדק מול מערכת אמיתית (24/09/2026):
 *
 *   ישיר:  <מספר-מערכת>:<סיסמה>   קבוע, מתועד ב-DownloadFile ו-RunCampaign
 *   סשן:   מחרוזת מ-Login          זמני
 *
 * הטוקן הישיר נדחה ב-ValidationToken עם
 * `EXCEPTION — IllegalStateException(session token is invalid)`,
 * בעוד ש-`Login?username=<מספר>&password=<סיסמה>` החזיר
 * `{"responseStatus":"OK","token":"..."}`.
 *
 * כלומר חלק מה-endpoints דורשים טוקן סשן, ולא ידוע אילו. לכן:
 * שולחים את הטוקן הישיר (מתועד, בלי round trip מיותר בתוך שיחה), ורק
 * אם ימות דוחה אותו כשגיאת אימות — מתחברים פעם אחת ומנסים שוב.
 *
 * הבחירה הזו מכוונת: היא לא מניחה איזו צורה נכונה, אלא עומדת בשתיהן.
 * לגלות את ההבדל הזה באמצע שיחה אמיתית, עם הקלטה שאי אפשר להוריד,
 * זה בדיוק מה שדרישה 12 מנסה למנוע.
 */
import { config } from '../config/index.js';
import { logger } from '../logging/logger.js';

export class YemotApiError extends Error {
    constructor (message, { command, responseStatus, body, httpStatus } = {}) {
        super(message);
        this.name = 'YemotApiError';
        this.command = command;
        this.responseStatus = responseStatus;
        this.body = body;
        this.httpStatus = httpStatus;
    }
}

/**
 * טוקן הסשן נשמר בזיכרון בלבד ולא מותמד לדיסק: הוא זמני, ותמיד ניתן
 * להשיגו מחדש מתוך הפרטים שב-YEMOT_TOKEN.
 */
let sessionToken = null;

/** מפרק את YEMOT_TOKEN. הפיצול על הנקודתיים *הראשונה* בלבד — סיסמה רשאית להכיל נקודתיים. */
function credentials () {
    const raw = config.yemot.token || '';
    const separator = raw.indexOf(':');

    if (separator === -1) {
        throw new YemotApiError('YEMOT_TOKEN אינו בפורמט <מספר-מערכת>:<סיסמה>', { command: 'Login' });
    }

    return {
        username: raw.slice(0, separator),
        password: raw.slice(separator + 1)
    };
}

/**
 * האם התשובה היא דחיית אימות, להבדיל מכל שגיאה אחרת.
 * חשוב שתהיה צרה: שגיאת נתיב או פרמטר לא אמורה לגרור התחברות מחדש.
 */
function isAuthFailure (body) {
    if (!body || !body.responseStatus || body.responseStatus === 'OK') return false;
    return /session token|token is invalid|invalid token|unauthorized|forbidden/i
        .test(String(body.message || '') + ' ' + String(body.responseStatus));
}

function buildUrl (command, params, { token } = {}) {
    const url = new URL(`${config.yemot.apiBase}/${command}`);
    url.searchParams.set('token', token || sessionToken || config.yemot.token);

    for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return url;
}

/** קריאה בודדת. לא מנסה שוב — הניסיון החוזר מנוהל ב-request(). */
async function performRequest (command, params, { timeoutMs = 15000, token } = {}) {
    const url = buildUrl(command, params, { token });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();

        let body;
        try {
            body = JSON.parse(text);
        } catch {
            throw new YemotApiError(`${command}: תשובה שאינה JSON`, {
                command, httpStatus: response.status, body: text.slice(0, 400)
            });
        }

        if (!response.ok) {
            throw new YemotApiError(`${command}: HTTP ${response.status}`, {
                command, httpStatus: response.status, body
            });
        }

        return body;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new YemotApiError(`${command}: פג הזמן אחרי ${timeoutMs}ms`, { command });
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * התחברות והשגת טוקן סשן.
 * אומת מול מערכת אמיתית: מחזיר {"responseStatus":"OK","token":"..."}.
 * לעולם לא מנסה שוב מעצמו — אחרת כישלון סיסמה היה הופך ללולאה.
 */
async function login ({ timeoutMs = 15000 } = {}) {
    const { username, password } = credentials();

    // Login מזדהה בשם ובסיסמה ולא בטוקן, ולכן עוקף את buildUrl.
    const url = new URL(`${config.yemot.apiBase}/Login`);
    url.searchParams.set('username', username);
    url.searchParams.set('password', password);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        const body = JSON.parse(await response.text());

        if (body.responseStatus !== 'OK' || !body.token) {
            throw new YemotApiError(`Login נדחה: ${body.message || body.responseStatus || 'ללא פירוט'}`, {
                command: 'Login', responseStatus: body.responseStatus, body
            });
        }

        sessionToken = body.token;
        logger.debug('התקבל טוקן סשן מימות');
        return sessionToken;
    } catch (error) {
        sessionToken = null;
        if (error instanceof YemotApiError) throw error;
        if (error.name === 'AbortError') {
            throw new YemotApiError(`Login: פג הזמן אחרי ${timeoutMs}ms`, { command: 'Login' });
        }
        throw new YemotApiError(`Login נכשל: ${error.message}`, { command: 'Login' });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * קריאה שמחזירה JSON.
 *
 * responseStatus שאינו OK מתורגם לשגיאה — ימות מחזירה 200 גם על כישלון
 * לוגי, ובלי הבדיקה הזו כישלון היה נראה כהצלחה.
 *
 * דחיית אימות מטופלת בנפרד: מתחברים פעם אחת ומנסים שוב עם טוקן סשן.
 * ניסיון חוזר *אחד* בלבד, וכל שגיאה אחרת אינה מפעילה התחברות.
 */
async function request (command, params, options = {}) {
    let body = await performRequest(command, params, options);

    if (isAuthFailure(body)) {
        logger.debug('ימות דחתה את הטוקן, מתחבר מחדש', { command });

        sessionToken = null;
        const freshToken = await login({ timeoutMs: options.timeoutMs });
        body = await performRequest(command, params, { ...options, token: freshToken });
    }

    if (body.responseStatus && body.responseStatus !== 'OK') {
        throw new YemotApiError(`${command}: ${body.responseStatus} — ${body.message || 'ללא פירוט'}`, {
            command, responseStatus: body.responseStatus, body
        });
    }

    return body;
}

/**
 * ניסיון הורדה בודד.
 * מחזיר {ok:true, buffer} או {ok:false, body} — ולא זורק על שגיאה לוגית,
 * כדי ש-downloadFile יוכל להחליט אם מדובר בדחיית אימות ששווה ניסיון חוזר.
 */
async function performDownload (path, { timeoutMs = 30000, token } = {}) {
    const url = buildUrl('DownloadFile', { path }, { token });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
            throw new YemotApiError(`DownloadFile: HTTP ${response.status}`, {
                command: 'DownloadFile', httpStatus: response.status
            });
        }

        const contentType = response.headers.get('content-type') || '';
        const buffer = Buffer.from(await response.arrayBuffer());

        if (contentType.includes('application/json')) {
            let body;
            try {
                body = JSON.parse(buffer.toString('utf8'));
            } catch {
                body = { message: buffer.toString('utf8').slice(0, 400) };
            }
            return { ok: false, body };
        }

        if (buffer.length === 0) {
            throw new YemotApiError('DownloadFile: הקובץ ריק', { command: 'DownloadFile' });
        }

        return { ok: true, buffer };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new YemotApiError(`DownloadFile: פג הזמן אחרי ${timeoutMs}ms`, { command: 'DownloadFile' });
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

export function createYemotApi () {
    return {
        /**
         * הורדת קובץ הקלטה ממערכת ימות.
         *
         * מסלול נפרד מ-request() כי התשובה בינארית. כשההורדה נכשלת לוגית,
         * ימות מחזירה JSON במקום אודיו — ואם זו דחיית אימות, מתחברים
         * ומנסים שוב, בדיוק כמו בשאר הקריאות. בלי זה, הקלטה של המשתמש
         * הייתה נשארת בלתי נגישה בגלל טוקן שפג (דרישה 12).
         *
         * @param {string} path נתיב כפי ש-read('record') החזיר, למשל "ivr2:/1/000.wav"
         * @returns {Promise<Buffer>}
         */
        async downloadFile (path, { timeoutMs = 30000 } = {}) {
            if (!path) throw new YemotApiError('DownloadFile: נתיב ריק', { command: 'DownloadFile' });

            const attempt = await performDownload(path, { timeoutMs });
            if (attempt.ok) return attempt.buffer;

            if (isAuthFailure(attempt.body)) {
                logger.debug('ימות דחתה את הטוקן בהורדת קובץ, מתחבר מחדש');

                sessionToken = null;
                const freshToken = await login({ timeoutMs });
                const retry = await performDownload(path, { timeoutMs, token: freshToken });

                if (retry.ok) return retry.buffer;

                throw new YemotApiError(
                    `DownloadFile: ימות דחתה גם אחרי התחברות מחדש — ${retry.body?.message || 'ללא פירוט'}`,
                    { command: 'DownloadFile', body: retry.body }
                );
            }

            throw new YemotApiError('DownloadFile: ימות החזירה שגיאה במקום קובץ', {
                command: 'DownloadFile',
                body: attempt.body
            });
        },

        /**
         * הפעלת קמפיין חיוג יוצא — זה המנגנון שמשמש לשיחת התזכורת.
         *
         * ⚠ טעון אימות לפני הרצה בייצור (אפיון, דרישה 2 ודרישה 28):
         *    יש לוודא מול התיעוד העדכני של ימות כיצד מעבירים שיחת קמפיין
         *    לשלוחת API לצורך קליטת הקשות 1/2/3, ומה עלות החיוג בפועל.
         *    אין להוסיף כאן פרמטרים שלא אומתו.
         *
         * @param {Array<{phone: string, text?: string}>} targets
         */
        async runCampaign ({ targets, ttsMode = true, extraParams = {} }) {
            if (!Array.isArray(targets) || targets.length === 0) {
                throw new YemotApiError('RunCampaign: אין יעדים', { command: 'RunCampaign' });
            }

            const params = {
                phones: targets,
                ...(ttsMode ? { ttsMode: 1 } : {}),
                ...(config.yemot.callerId ? { callerId: config.yemot.callerId } : {}),
                ...extraParams
            };

            logger.debug('RunCampaign', { targetCount: targets.length, ttsMode });
            return request('RunCampaign', params);
        },

        /** צינתוק — צלצול בלבד, בלי השמעה. */
        async runTzintuk ({ phones, timeoutSeconds }) {
            return request('RunTzintuk', {
                phones,
                ...(config.yemot.callerId ? { callerId: config.yemot.callerId } : {}),
                ...(timeoutSeconds ? { TzintukTimeOut: timeoutSeconds } : {})
            });
        },

        /**
         * בדיקת חיבור.
         *
         * משתמש ב-Login — ה-endpoint היחיד שאומת בפועל מול מערכת אמיתית.
         * הגרסה הקודמת קראה ל-GetSession, שמעולם לא אומת שהוא קיים, ולכן
         * דיווחה כישלון גם כששאר המערכת הייתה תקינה.
         */
        async verifyToken () {
            const token = await login();
            return { responseStatus: 'OK', hasSessionToken: Boolean(token) };
        },

        /** לבדיקות: איפוס טוקן הסשן השמור. */
        resetSession () {
            sessionToken = null;
        },

        request
    };
}
