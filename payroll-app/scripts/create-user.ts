/* יצירת משתמש / איפוס סיסמה: npm run create-user -- <username> <password> */
import bcrypt from "bcryptjs";
import { getDb } from "../src/server/db";

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 8) {
  console.error("שימוש: npm run create-user -- <שם משתמש> <סיסמה באורך 8 לפחות>");
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 12);
getDb().prepare(`INSERT INTO users (username, password_hash) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`).run(username, hash);
console.log(`המשתמש ${username} נשמר.`);
