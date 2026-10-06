// בדיקת קבלה מקצה לקצה דרך הדפדפן (תרחיש סעיף 43 במפרט):
// מעסיק → עובד → הרצת שכר → חישוב → אישור → תלוש PDF → חשבון בנק → ייבוא Excel → התאמה → דף חשבון.
// הרצה: שרת פועל על מסד ריק (DATABASE_PATH=... npm start), ואז: BASE_URL=http://localhost:3000 node e2e/acceptance.mjs
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const exe = process.env.CHROMIUM_PATH ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
const step = (s) => console.log("✓", s);
const flashErr = async () => (await page.$(".flash.err")) && (await page.$eval(".flash.err", (e) => e.textContent));
const submit = async (selector = "main button[type=submit]") => {
  const prev = page.url();
  await page.click(selector);
  // כל Server Action מפנה לכתובת חדשה (עם ?ok= / ?err= או דף אחר)
  await page.waitForURL((u) => u.toString() !== prev, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  const err = await flashErr();
  if (err) throw new Error(`שגיאה בטופס: ${err}`);
};
const fill = async (name, v) => page.fill(`[name="${name}"]`, String(v));

// 1. התחברות / הגדרה ראשונה
await page.goto(base + "/login");
await fill("username", "admin");
await fill("password", "Passw0rd!");
if (await page.$("[name=password2]")) await fill("password2", "Passw0rd!");
await submit("button[type=submit]");
step("כניסה");

// 2. מעסיק
await page.goto(base + "/employers/new");
await fill("name", "בדיקה בע\"מ"); await fill("company_id", "514444444"); await fill("deductions_file", "934444444");
await page.selectOption("[name=bank_code]", "12"); await fill("branch", "600"); await fill("account", "111111");
await fill("masav_institution_code", "11111111"); await fill("masav_sender_code", "11111");
await submit();
const employerId = page.url().match(/employers\/(\d+)/)[1];
step(`מעסיק ${employerId}`);

// 3. עובד: גיל 27, חודשי, 100%, 12,000
await page.goto(base + `/employees/new?employer=${employerId}`);
await fill("first_name", "דני"); await fill("last_name", "בודק"); await fill("id_number", "000000034");
await fill("birth_date", "1999-01-15");
await page.selectOption("[name=bank_code]", "10"); await fill("branch", "800"); await fill("account", "7654321");
await fill("start_date", "2025-01-01"); await fill("base_salary", "12000"); await fill("travel_daily", "15");
await fill("pension_start", "2025-01-01");
await submit();
const employeeId = page.url().match(/employees\/(\d+)/)[1];
step(`עובד ${employeeId}`);

// 4. פרופיל מס 2026
await page.goto(base + `/employees/${employeeId}?tab=tax&year=2026`);
await submit("main button:has-text('שמירת פרופיל')");
step("פרופיל מס");

// 5. הרצת שכר ינואר 2026 לעובד
await page.goto(base + `/payroll/new?employer=${employerId}&employee=${employeeId}&year=2026&month=1`);
await submit();
const [, runId, epId] = page.url().match(/payroll\/(\d+)\/(\d+)/);
await fill("workDays", 21); await fill("ot125", 4); await fill("ot150", 1);
await page.selectOption("[name=c_type_0]", "BONUS"); await fill("c_desc_0", "בונוס"); await fill("c_amount_0", 1000);
await submit("button:has-text('שמירה וחישוב')");
const net = await page.$eval(".stat:has-text('נטו לתשלום') .v", (e) => e.textContent);
step(`חישוב: נטו לתשלום ${net}`);
if (!(await page.$("text=כיצד חושב?"))) throw new Error("חסר מסך הסבר");
step("מסך 'כיצד חושב?'");

// 6. חישוב ואישור ההרצה
await page.goto(base + `/payroll/${runId}`);
await submit("button:has-text('חשב את כל העובדים')");
await submit("button:has-text('אישור ונעילה')");
step("אישור ונעילה");
await page.goto(base + `/payroll/${runId}/${epId}`);
const payslipHref = await page.$eval("a:has-text('לתלוש')", (a) => a.getAttribute("href"));
const payslipId = payslipHref.split("/").pop();

// 7. PDF
const pdf = await page.request.get(base + `/api/payslips/${payslipId}/pdf`);
if (pdf.headers()["content-type"] !== "application/pdf") throw new Error("PDF לא הופק");
step(`PDF (${(await pdf.body()).length} bytes)`);

// 8. חשבון בנק אמיתי של העובד + ייבוא Excel עם המשכורת
await page.goto(base + "/bank/new");
await page.selectOption("[name=bank_code]", "10"); await fill("branch", "800"); await fill("account_number", "7654321"); await fill("holder", "דני בודק");
await submit();
const accountId = page.url().match(/bank\/(\d+)/)[1];
const netNum = Number(net.replace(/[^\d.]/g, ""));
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("תנועות");
ws.addRow(["בנק לאומי – תנועות בחשבון"]);
ws.addRow([]);
ws.addRow(["תאריך", "תאריך ערך", "תיאור", "אסמכתא", "חובה", "זכות", "יתרה בש\"ח"]);
ws.addRow(["01/02/2026", "01/02/2026", "יתרת פתיחה", "", "", "", "5,000.00"]);
ws.addRow(["03/02/2026", "03/02/2026", "הוראת קבע ארנונה", "777", "350.00", "", "4,650.00"]);
ws.addRow(["09/02/2026", "09/02/2026", "משכורת בדיקה בע\"מ", "SAL", "", netNum.toFixed(2), (4650 + netNum).toFixed(2)]);
ws.addRow(["10/02/2026", "10/02/2026", "ישראכרט", "", "1,200.00", "", (4650 + netNum - 1200).toFixed(2)]);
const file = path.join(os.tmpdir(), `bank-${Date.now()}.xlsx`);
await wb.xlsx.writeFile(file);
await page.goto(base + `/bank/${accountId}/import`);
await page.setInputFiles("[name=file]", file);
await submit();
await submit("button:has-text('תצוגה מקדימה')");
await page.check("[name=set_opening]");
await fill("save_as", "לאומי – בדיקה");
await submit("button:has-text('ייבוא')");
step("ייבוא Excel");
const recon = await page.$eval(".msg:has-text('בדיקה')", (e) => e.textContent);
if (!recon.includes("תקין")) throw new Error("Reconciliation נכשל: " + recon);
step("Reconciliation תקין: " + recon.trim());

// 9. התאמה
await page.goto(base + "/matching");
await submit("button:has-text('אישור אוטומטי')");
const matched = await page.$$eval("h2", (hs) => hs.map((h) => h.textContent).find((t) => t.includes("התאמות שאושרו")));
if (!matched.includes("(1)")) throw new Error("ההתאמה לא נמצאה: " + matched);
step("התאמה שכר ↔ בנק");

// 10. דוחות
const r126 = await page.request.get(base + `/api/reports/126?employer=${employerId}&year=2026`);
if (!(await r126.text()).includes("000000034")) throw new Error("דוח 126 חסר");
step("דוח שנתי");

fs.unlinkSync(file);
await browser.close();
if (errors.length) { console.error("שגיאות דף:", errors); process.exit(1); }
console.log("בדיקת הקבלה עברה בהצלחה.");
