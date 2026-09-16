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

function buildUrl (command, params) {
    const url = new URL(`${config.yemot.apiBase}/${command}`);
    url.searchParams.set('token', config.yemot.token);

    for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return url;
}

/**
 * קריאה שמחזירה JSON.
 * responseStatus שאינו OK מתורגם לשגיאה — ימות מחזירה 200 גם על כישלון
 * לוגי, ובלי הבדיקה הזו כישלון היה נראה כהצלחה.
 */
async function request (command, params, { timeoutMs = 15000 } = {}) {
    const url = buildUrl(command, params);
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

        if (body.responseStatus && body.responseStatus !== 'OK') {
            throw new YemotApiError(`${command}: ${body.responseStatus} — ${body.message || 'ללא פירוט'}`, {
                command, responseStatus: body.responseStatus, body
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

export function createYemotApi () {
    return {
        /**
         * הורדת קובץ הקלטה ממערכת ימות.
         * @param {string} path נתיב כפי ש-read('record') החזיר, למשל "ivr2:/1/000.wav"
         * @returns {Promise<Buffer>}
         */
        async downloadFile (path, { timeoutMs = 30000 } = {}) {
            if (!path) throw new YemotApiError('DownloadFile: נתיב ריק', { command: 'DownloadFile' });

            const url = buildUrl('DownloadFile', { path });
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetch(url, { signal: controller.signal });

                if (!response.ok) {
                    throw new YemotApiError(`DownloadFile: HTTP ${response.status}`, {
                        command: 'DownloadFile', httpStatus: response.status
                    });
                }

                // כשההורדה נכשלת לוגית, ימות מחזירה JSON במקום אודיו.
                // בלי הבדיקה הזו היינו שולחים הודעת שגיאה למנוע התמלול.
                const contentType = response.headers.get('content-type') || '';
                const buffer = Buffer.from(await response.arrayBuffer());

                if (contentType.includes('application/json')) {
                    throw new YemotApiError('DownloadFile: ימות החזירה שגיאה במקום קובץ', {
                        command: 'DownloadFile',
                        body: buffer.toString('utf8').slice(0, 400)
                    });
                }

                if (buffer.length === 0) {
                    throw new YemotApiError('DownloadFile: הקובץ ריק', { command: 'DownloadFile' });
                }

                return buffer;
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw new YemotApiError(`DownloadFile: פג הזמן אחרי ${timeoutMs}ms`, { command: 'DownloadFile' });
                }
                throw error;
            } finally {
                clearTimeout(timer);
            }
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

        /** בדיקת חיבור: קריאה זולה שמאמתת שהטוקן תקף. */
        async verifyToken () {
            return request('GetSession', {});
        },

        request
    };
}
