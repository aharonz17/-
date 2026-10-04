/**
 * העלאת הקלטות ל-Google Drive.
 *
 * מבנה התיקיות לפי סעיף 10 באפיון:
 *   העוזר הקולי / הקלטות / <שנה> / <חודש>
 *
 * התיקיות נוצרות לפי דרישה ונשמרות ב-cache, כדי לא לשלם קריאת חיפוש
 * על כל הקלטה.
 */
import { createReadStream } from 'node:fs';
import { getDrive } from './google-auth.js';
import { config } from '../config/index.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const folderCache = new Map();

function escapeForQuery (name) {
    return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** מחזיר מזהה תיקייה, יוצר אותה אם אינה קיימת. */
async function ensureFolder (drive, name, parentId) {
    const cacheKey = `${parentId}/${name}`;
    if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);

    const query = [
        `name = '${escapeForQuery(name)}'`,
        `mimeType = '${FOLDER_MIME}'`,
        `'${parentId}' in parents`,
        'trashed = false'
    ].join(' and ');

    const { data } = await drive.files.list({
        q: query,
        fields: 'files(id, name)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });

    let folderId = data.files?.[0]?.id;

    if (!folderId) {
        const created = await drive.files.create({
            requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
            fields: 'id',
            supportsAllDrives: true
        });
        folderId = created.data.id;
    }

    folderCache.set(cacheKey, folderId);
    return folderId;
}

const MIME_BY_EXTENSION = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4'
};

export function createDriveWriter () {
    return {
        /**
         * @returns {Promise<{fileId: string, link: string}>}
         */
        async uploadRecording ({ localPath, fileName, year, month }) {
            if (!config.google.driveFolderId) {
                throw new Error('GOOGLE_DRIVE_FOLDER_ID חסר — לא ניתן להעלות הקלטות');
            }

            const drive = await getDrive();

            const recordingsFolder = await ensureFolder(drive, 'הקלטות', config.google.driveFolderId);
            const yearFolder = await ensureFolder(drive, year, recordingsFolder);
            const monthFolder = await ensureFolder(drive, month, yearFolder);

            const extension = fileName.split('.').pop()?.toLowerCase();

            const { data } = await drive.files.create({
                requestBody: { name: fileName, parents: [monthFolder] },
                media: {
                    mimeType: MIME_BY_EXTENSION[extension] || 'application/octet-stream',
                    body: createReadStream(localPath)
                },
                fields: 'id, webViewLink',
                supportsAllDrives: true
            });

            return { fileId: data.id, link: data.webViewLink };
        },

        /** לבדיקות חיבור: מוודא שהתיקייה קיימת ושיש הרשאת כתיבה. */
        async verifyAccess () {
            const drive = await getDrive();
            const { data } = await drive.files.get({
                fileId: config.google.driveFolderId,
                fields: 'id, name, capabilities(canAddChildren)',
                supportsAllDrives: true
            });
            return data;
        }
    };
}
