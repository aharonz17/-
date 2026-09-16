/**
 * הגדרות סביבה לבדיקות.
 * חייב להיטען לפני כל מודול שקורא את config, ולכן מיובא ראשון בכל קובץ בדיקה.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.WEBHOOK_SECRET = 'test-secret-value-1234567890';
process.env.YEMOT_TOKEN = '0771234567:testpass';
process.env.AUTHORIZED_PHONE = '0501234567';
process.env.GEMINI_API_KEY = 'test-key';
process.env.TIMEZONE = 'Asia/Jerusalem';
process.env.DATABASE_PATH = `./data/test-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`;

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

export function cleanupDatabase () {
    const path = resolve(process.cwd(), process.env.DATABASE_PATH);
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try { rmSync(`${path}${suffix}`); } catch { /* לא קיים — בסדר */ }
    }
}
