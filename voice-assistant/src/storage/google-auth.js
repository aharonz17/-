/**
 * אימות מול Google.
 *
 * דרישה 15: אין credentials בקוד. הנתיב לקובץ ה-service account מגיע
 * מהסביבה, וב-Cloud Run אפשר לוותר עליו לגמרי ולהסתמך על זהות המופע
 * (Application Default Credentials) — ואז אין קובץ מפתח בכלל, וזה עדיף.
 */
import { google } from 'googleapis';
import { config } from '../config/index.js';

const SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents'
];

let authClientPromise = null;

export function getAuth () {
    if (!authClientPromise) {
        const auth = new google.auth.GoogleAuth({
            scopes: SCOPES,
            // undefined -> Application Default Credentials (מומלץ ב-Cloud Run)
            keyFile: config.google.credentialsPath || undefined
        });
        authClientPromise = auth.getClient();
    }
    return authClientPromise;
}

export async function getDrive () {
    return google.drive({ version: 'v3', auth: await getAuth() });
}

export async function getSheets () {
    return google.sheets({ version: 'v4', auth: await getAuth() });
}

export async function getDocs () {
    return google.docs({ version: 'v1', auth: await getAuth() });
}

export { SCOPES };
