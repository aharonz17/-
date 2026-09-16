/**
 * יומן קריא ב-Google Docs — סעיף 12 באפיון.
 *
 * ה-Docs הוא תצוגה בלבד. דרישה 22: "אין לשמור רק ב-Google Docs. המידע
 * המובנה צריך להיות במסד נתונים מתאים." מקור האמת הוא SQLite.
 *
 * ארבע החלטות מימוש שחוזרות על עצמן בכל אינטגרציה ל-Docs, ושבירתן היא
 * הסיבה הרגילה לכך שמסמכים יוצאים משובשים:
 *
 *   1. מסמך לחודש. ל-Docs יש תקרה של כמיליון תווים, ומסמך גדול נפתח לאט
 *      בנייד. מסמך "לנצח" נשבר בשקט אחרי שנה.
 *
 *   2. RTL מפורש. Docs לא מסיק כיווניות מתוכן עברי. בלי updateParagraphStyle
 *      עם direction: RIGHT_TO_LEFT, הפיסוק מופיע בצד הלא נכון.
 *
 *   3. אינדקסים. insertText עובד לפי מיקום תו, וכל הוספה מזיזה את מה שאחריה.
 *      כאן מוסיפים בלוק אחד ומחשבים את כל ההיסטים מתוכו — במקום כמה
 *      הוספות שכל אחת מזיזה את הבאות.
 *
 *   4. כתיבה אחת בכל רגע. שתי כתיבות במקביל לאותו מסמך משחיתות אותו,
 *      ולכן כל הקריאות עוברות דרך תור סדרתי.
 *
 * המסמך append-only: "בוצע" מוסיף שורה ולא עורך את הקיימת. עריכה במקום
 * דורשת חישוב אינדקסים מחדש בכל פעם, וזה מקור באגים בתמורה לערך אסתטי.
 */
import { getDocs, getDrive } from './google-auth.js';
import { config } from '../config/index.js';
import { fromStorage, hebrewDayHeading, hebrewMonth } from '../domain/time.js';

const DOCS_MIME = 'application/vnd.google-apps.document';

/** תור סדרתי — מונע כתיבות מקבילות לאותו מסמך (החלטה 4). */
let writeChain = Promise.resolve();

function serialize (task) {
    const result = writeChain.then(task, task);
    // שרשרת התור לא נשברת בגלל כישלון של משימה אחת
    writeChain = result.then(() => undefined, () => undefined);
    return result;
}

function escapeForQuery (name) {
    return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function monthlyDocumentTitle (dateTime) {
    return `העוזר הקולי — ${hebrewMonth(dateTime)} ${dateTime.year}`;
}

const documentIdCache = new Map();

/** מוצא או יוצר את מסמך החודש בתיקיית היעד. */
async function ensureMonthlyDocument (dateTime) {
    const title = monthlyDocumentTitle(dateTime);
    if (documentIdCache.has(title)) return documentIdCache.get(title);

    if (!config.google.docsFolderId) {
        throw new Error('GOOGLE_DOCS_FOLDER_ID חסר — לא ניתן ליצור את יומן ה-Docs');
    }

    const drive = await getDrive();

    const { data } = await drive.files.list({
        q: [
            `name = '${escapeForQuery(title)}'`,
            `mimeType = '${DOCS_MIME}'`,
            `'${config.google.docsFolderId}' in parents`,
            'trashed = false'
        ].join(' and '),
        fields: 'files(id)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });

    let documentId = data.files?.[0]?.id;

    if (!documentId) {
        const created = await drive.files.create({
            requestBody: { name: title, mimeType: DOCS_MIME, parents: [config.google.docsFolderId] },
            fields: 'id',
            supportsAllDrives: true
        });
        documentId = created.data.id;
    }

    documentIdCache.set(title, documentId);
    return documentId;
}

/**
 * מחזיר את מיקום ההוספה בסוף המסמך ואת הטקסט הקיים.
 *
 * ההוספה היא ב-endIndex - 1: התו האחרון בגוף המסמך הוא תמיד שורה חדשה
 * שלא ניתן להוסיף אחריה, ו-Docs דוחה אינדקס שמצביע עליה או אחריה.
 */
async function readDocumentTail (docs, documentId) {
    const { data } = await docs.documents.get({ documentId });
    const content = data.body?.content || [];

    const endIndex = content.length > 0
        ? content[content.length - 1].endIndex
        : 1;

    const text = content
        .map((element) => (element.paragraph?.elements || [])
            .map((run) => run.textRun?.content || '')
            .join(''))
        .join('');

    return { insertAt: Math.max(1, endIndex - 1), text };
}

const TYPE_MARK = { reminder: '⏰', note: '📝', question: '❓' };

export function createDocsWriter () {
    return {
        /**
         * מוסיף שורה ליומן.
         *
         * @param {object} input
         * @param {import('luxon').DateTime} input.at זמן הרשומה
         * @param {string} input.type note | reminder | question
         * @param {string} input.text תוכן הרשומה
         * @param {string} [input.recordingLink] קישור להקלטה המקורית (דרישה 22)
         * @param {string} [input.suffix] תוספת בסוף השורה, למשל זמן התזכורת
         */
        appendEntry (input) {
            return serialize(async () => {
                const { at, type, text, recordingLink, suffix } = input;

                const docs = await getDocs();
                const documentId = await ensureMonthlyDocument(at);
                const { insertAt, text: existingText } = await readDocumentTail(docs, documentId);

                const heading = hebrewDayHeading(at);
                const needsHeading = !existingText.includes(heading);

                // בונים בלוק אחד ומחשבים ממנו את כל ההיסטים (החלטה 3).
                const headingBlock = needsHeading ? `\n${heading}\n` : '';

                const mark = TYPE_MARK[type] || '•';
                const clock = at.toFormat('HH:mm');
                const lineBody = `${clock}  ${mark}  ${text}${suffix ? `  ${suffix}` : ''}`;
                const linkLabel = recordingLink ? '  🎧 האזן' : '';
                const lineBlock = `${lineBody}${linkLabel}\n`;

                const fullBlock = `${headingBlock}${lineBlock}`;

                const requests = [
                    { insertText: { location: { index: insertAt }, text: fullBlock } }
                ];

                // היסטים בתוך הבלוק שהוספנו זה עתה
                const headingStart = insertAt + 1;                       // אחרי \n הפותח
                const headingEnd = headingStart + heading.length + 1;    // כולל \n הסוגר
                const lineStart = insertAt + headingBlock.length;
                const lineEnd = lineStart + lineBlock.length;

                if (needsHeading) {
                    requests.push({
                        updateParagraphStyle: {
                            range: { startIndex: headingStart, endIndex: headingEnd },
                            paragraphStyle: { namedStyleType: 'HEADING_2', direction: 'RIGHT_TO_LEFT' },
                            fields: 'namedStyleType,direction'
                        }
                    });
                }

                requests.push({
                    updateParagraphStyle: {
                        range: { startIndex: lineStart, endIndex: lineEnd },
                        paragraphStyle: { namedStyleType: 'NORMAL_TEXT', direction: 'RIGHT_TO_LEFT' },
                        fields: 'namedStyleType,direction'
                    }
                });

                if (recordingLink) {
                    const labelStart = lineStart + lineBody.length;
                    requests.push({
                        updateTextStyle: {
                            range: { startIndex: labelStart, endIndex: labelStart + linkLabel.length },
                            textStyle: { link: { url: recordingLink } },
                            fields: 'link'
                        }
                    });
                }

                await docs.documents.batchUpdate({ documentId, requestBody: { requests } });

                return { documentId, insertedChars: fullBlock.length };
            });
        },

        /** לבדיקת חיבור. */
        async verifyAccess (dateTime) {
            const documentId = await ensureMonthlyDocument(dateTime);
            const docs = await getDocs();
            const { data } = await docs.documents.get({ documentId });
            return { documentId, title: data.title };
        },

        monthlyDocumentTitle
    };
}

export { fromStorage };
