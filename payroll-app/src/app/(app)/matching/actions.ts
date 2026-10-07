"use server";
import { runAction } from "@/lib/action";
import { num } from "@/lib/form";
import { autoMatch, confirmMatch, postPaymentToSimulatedAccount, suggestMatches, unmatch } from "@/server/bank";

export async function autoMatchAction() {
  await runAction("/matching", (actor) => {
    const n = autoMatch(actor);
    return { ok: n ? `${n} התאמות ודאיות אושרו אוטומטית` : "לא נמצאו התאמות ודאיות חדשות" };
  });
}

export async function confirmAction(paymentId: number, txnId: number) {
  await runAction("/matching", (actor) => {
    const m = suggestMatches().find((x) => x.paymentId === paymentId && x.txnId === txnId);
    if (!m) throw new Error("ההצעה כבר לא בתוקף");
    confirmMatch(m, actor);
    return { ok: "ההתאמה אושרה" };
  });
}

export async function unmatchAction(paymentId: number) {
  await runAction("/matching", (actor) => {
    unmatch(paymentId, actor);
    return { ok: "השיוך בוטל" };
  });
}

export async function postToSimAction(paymentId: number, fd: FormData) {
  await runAction("/payments", (actor) => {
    const acc = num(fd, "account_id");
    if (!acc) throw new Error("בחרו חשבון");
    postPaymentToSimulatedAccount(paymentId, acc, actor);
    return { ok: "התשלום נרשם כתנועת זכות בחשבון ההדמיה. עברו להתאמות." };
  });
}
