import { requireUser } from "@/server/auth";
import { getPayslip } from "@/server/payroll";
import { renderPayslipHtml } from "@/pdf/payslip-html";
import { htmlToPdf } from "@/pdf/render";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const p = getPayslip(Number((await params).id));
  if (!p) return new Response("לא נמצא", { status: 404 });
  const html = renderPayslipHtml(p.snapshot, { payslipId: p.id, hash: p.hash, status: p.status });
  try {
    const pdf = await htmlToPdf(html);
    const name = `payslip-${p.year}-${String(p.month).padStart(2, "0")}-${p.snapshot.employee.id_number}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"`, "cache-control": "no-store" },
    });
  } catch {
    // אין Chromium זמין – מחזירים HTML להדפסה מהדפדפן (Ctrl+P → שמירה כ-PDF)
    return new Response(html.replace("</body>", `<script>window.onload=()=>window.print()</script></body>`), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
