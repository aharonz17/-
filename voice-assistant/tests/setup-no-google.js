/**
 * כמו setup.js, אבל בלי Drive, Sheets ו-Docs — שרת שכל המידע שלו ב-SQLite.
 * חייב להיטען לפני כל מודול שקורא את config.
 */
process.env.GOOGLE_DRIVE_FOLDER_ID = '';
process.env.GOOGLE_SHEET_ID = '';
process.env.GOOGLE_DOCS_FOLDER_ID = '';

export { cleanupDatabase } from './setup.js';
