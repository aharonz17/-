/**
 * מראה ב-Google Sheets — הטבלה של סעיף 11 באפיון.
 *
 * זו שכבת תצוגה, לא מסד נתונים. מקור האמת הוא SQLite.
 * הסיבה מפורטת ב-src/storage/db.js.
 */
import { getSheets } from './google-auth.js';
import { config } from '../config/index.js';
import { fromStorage } from '../domain/time.js';

/** סדר העמודות לפי סעיף 11, עם שתי תוספות מעקב (דרישה 23). */
export const SHEET_HEADERS = Object.freeze([
    'ID', 'Date', 'Time', 'Type', 'Original Text', 'Transcript',
    'Status', 'Reminder Time', 'Recording', 'Created', 'Call ID', 'Engine'
]);

const SHEET_NAME = 'Entries';

export function createSheetsWriter () {
    return {
        /** יוצר את לשונית היעד ואת שורת הכותרות אם אינן קיימות. */
        async ensureSheet () {
            const sheets = await getSheets();
            const spreadsheetId = config.google.sheetId;

            const { data } = await sheets.spreadsheets.get({ spreadsheetId });
            const exists = data.sheets?.some((sheet) => sheet.properties?.title === SHEET_NAME);

            if (!exists) {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        requests: [{
                            addSheet: {
                                properties: {
                                    title: SHEET_NAME,
                                    // עברית: הגיליון נקרא מימין לשמאל
                                    rightToLeft: true
                                }
                            }
                        }]
                    }
                });
            }

            const header = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${SHEET_NAME}!A1:L1`
            });

            if (!header.data.values || header.data.values.length === 0) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `${SHEET_NAME}!A1`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [[...SHEET_HEADERS]] }
                });
            }
        },

        async appendEntry ({ entry, recording, reminder }) {
            if (!config.google.sheetId) {
                throw new Error('GOOGLE_SHEET_ID חסר — לא ניתן לכתוב לגיליון');
            }

            const sheets = await getSheets();
            const createdAt = fromStorage(entry.created_at);

            const row = [
                entry.entry_id,
                createdAt.toFormat('yyyy-MM-dd'),
                createdAt.toFormat('HH:mm:ss'),
                entry.type,
                entry.text || '',
                entry.transcript || '',
                reminder ? reminder.status : entry.status,
                reminder ? fromStorage(reminder.due_at).toFormat('yyyy-MM-dd HH:mm') : '',
                recording?.drive_link || recording?.yemot_path || '',
                entry.created_at,
                entry.call_id,
                entry.engine || ''
            ];

            await sheets.spreadsheets.values.append({
                spreadsheetId: config.google.sheetId,
                range: `${SHEET_NAME}!A:L`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: [row] }
            });
        }
    };
}
