import "server-only";
import fs from "node:fs";

// HTML → PDF עם Chromium (playwright-core). אם אין דפדפן זמין – זורק שגיאה, והממשק מציע הדפסה מהדפדפן.

function findChromium(): string | undefined {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return c;
      if (st.isDirectory()) {
        // תיקיית playwright: /opt/pw-browsers/chromium-XXXX/chrome-linux/chrome
        for (const sub of fs.readdirSync(c)) {
          const p = `${c}/${sub}/chrome-linux/chrome`;
          if (fs.existsSync(p)) return p;
        }
      }
    } catch { /* לא קיים */ }
  }
  return undefined;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const { chromium } = await import("playwright-core");
  const executablePath = findChromium();
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
