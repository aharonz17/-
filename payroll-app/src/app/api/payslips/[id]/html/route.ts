import { requireUser } from "@/server/auth";
import { getPayslip } from "@/server/payroll";
import { renderPayslipHtml } from "@/pdf/payslip-html";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const p = getPayslip(Number((await params).id));
  if (!p) return new Response("לא נמצא", { status: 404 });
  return new Response(renderPayslipHtml(p.snapshot, { payslipId: p.id, hash: p.hash, status: p.status }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
