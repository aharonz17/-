import { chromium } from "playwright-core";
import { getPayslip } from "/home/user/-/payroll-app/src/server/payroll";
import { renderPayslipHtml } from "/home/user/-/payroll-app/src/pdf/payslip-html";
async function main() {
const out = process.argv[2];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const id of [2, 5]) {
  const p = getPayslip(id)!;
  const page = await b.newPage();
  await page.setContent(renderPayslipHtml(p.snapshot, { payslipId: p.id, hash: p.hash, status: p.status }));
  await page.pdf({ path: `${out}/slip${id}.pdf`, format: "A4", printBackground: true });
  console.log(id, p.snapshot.result.totals.netToPay, p.snapshot.employee.first_name);
}
await b.close();
}
main();
