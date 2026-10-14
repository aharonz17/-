import { requireUser } from "@/server/auth";
import { getAccount, statementFor } from "@/server/bank";
import { logoDataUri } from "@/server/templates";
import { renderStatementHtml } from "@/pdf/statement-html";
import { htmlToPdf } from "@/pdf/render";
import { maskAccount } from "@/lib/format";
import type { Category } from "@/domain/bank/categorize";
import type { CanonicalTxn, Statement } from "@/domain/bank/statement";

export const runtime = "nodejs";
const isDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const acc = getAccount(Number((await params).id));
  if (!acc) return new Response("לא נמצא", { status: 404 });
  const u = new URL(req.url);
  const st = statementFor(acc.id, isDate(u.searchParams.get("from")), isDate(u.searchParams.get("to"))) as Statement<CanonicalTxn & { category: Category }>;
  const html = renderStatementHtml({
    holder: acc.holder, bankCode: acc.bank_code, branch: acc.branch, accountMasked: maskAccount(acc.account_number), simulated: acc.kind === "SIMULATED",
    statement: st, generatedAt: new Date().toISOString(), ownerLogo: acc.owner_type === "employer" && acc.owner_id ? logoDataUri(acc.owner_id) : null,
  });
  try {
    const pdf = await htmlToPdf(html);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="internal-report-${acc.id}.pdf"`, "cache-control": "no-store" } });
  } catch {
    return new Response(html.replace("</body>", "<script>window.onload=()=>window.print()</script></body>"), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
}
