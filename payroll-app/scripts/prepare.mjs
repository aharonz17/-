// נקרא מ-start.bat / start.sh: מתקין רכיבים ובונה מחדש רק כשצריך (אחרי עדכון גרסה).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const newest = (dir) => {
  let t = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : mtime(p));
  }
  return t;
};
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

const lock = fs.readFileSync("package-lock.json", "utf8");
const stampFile = "node_modules/.install-stamp";
const installed = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, "utf8") : "";
if (installed !== lock || !fs.existsSync("node_modules/next")) {
  console.log("Installing components (first run or after update)...");
  run("npm install --no-audit --no-fund");
  fs.writeFileSync(stampFile, lock);
}
const built = mtime(".next/BUILD_ID");
const src = Math.max(newest("src"), mtime("package-lock.json"), mtime("next.config.ts"));
if (!built || src > built) {
  console.log("Building the app (first run or after update)...");
  run("npm run build");
}
