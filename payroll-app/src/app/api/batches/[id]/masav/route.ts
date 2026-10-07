import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { getEmployer } from "@/server/repo";
import { listPayments } from "@/server/bank";
import { buildMasavFile } from "@/domain/bank/masav";
import { audit } from "@/server/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const batch = getDb().prepare("SELECT * FROM payment_batches WHERE id = ?").get(id) as { id: number; employer_id: number; payment_date: string } | undefined;
  if (!batch) return new Response("לא נמצא", { status: 404 });
  const er = getEmployer(batch.employer_id)!;
  if (!er.masav_institution_code || !er.masav_sender_code)
    return new Response("חסרים קוד מוסד וקוד שולח במס\"ב בפרטי המעסיק.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const pays = listPayments({ batchId: id }).filter((p) => p.status !== "CANCELLED");
  const missing = pays.filter((p) => !p.bank_code || !p.branch || !p.account);
  if (missing.length)
    return new Response(`חסרים פרטי בנק ל: ${missing.map((p) => p.beneficiary_name).join(", ")}`, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  try {
    const f = buildMasavFile({
      institutionCode: er.masav_institution_code, senderCode: er.masav_sender_code, institutionName: er.name,
      paymentDate: batch.payment_date, createdDate: new Date().toISOString().slice(0, 10),
      payments: pays.map((p) => ({
        bankCode: p.bank_code!, branch: p.branch!, account: p.account!, idNumber: p.beneficiary_id ?? "0", name: p.beneficiary_name,
        amount: p.amount, reference: p.reference ?? String(p.id),
        periodFrom: { year: p.year ?? 0, month: p.month ?? 0 }, periodTo: { year: p.year ?? 0, month: p.month ?? 0 },
      })),
    });
    audit({ entityType: "payment_batch", entityId: id, action: "EXPORT_MASAV", actor: user.username, newValue: { total: f.total, count: f.count, warnings: f.warnings } });
    return new Response(new Uint8Array(f.content), {
      headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="masav-batch-${id}.txt"` },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
