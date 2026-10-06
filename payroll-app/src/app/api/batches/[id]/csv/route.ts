import { requireUser } from "@/server/auth";
import { listPayments } from "@/server/bank";
import { toCsv } from "@/lib/csv";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  const rows = listPayments({ batchId: id });
  const csv = toCsv(["מוטב", "ת.ז", "בנק", "סניף", "חשבון", "סכום", "אסמכתא", "תאריך תשלום", "סטטוס"],
    rows.map((p) => [p.beneficiary_name, p.beneficiary_id, p.bank_code, p.branch, p.account, p.amount.toFixed(2), p.reference, p.payment_date, p.status]));
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="payments-batch-${id}.csv"` } });
}
