import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";

const withParam = (path: string, k: string, v: string) => `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;

/**
 * עוטף Server Action: בודק התחברות, מריץ, ומפנה חזרה עם הודעת הצלחה/שגיאה.
 * fn מחזירה נתיב יעד (או כלום = חזרה ל-back) והודעה אופציונלית. fn לא קוראת ל-redirect בעצמה.
 */
export async function runAction(
  back: string,
  fn: (actor: string) => Promise<{ to?: string; ok?: string } | void> | { to?: string; ok?: string } | void,
) {
  const user = await requireUser();
  let dest = back;
  try {
    const r = (await fn(user.username)) || {};
    dest = r.to ?? back;
    if (r.ok) dest = withParam(dest, "ok", r.ok);
  } catch (e) {
    dest = withParam(back, "err", (e as Error).message || "שגיאה");
  }
  revalidatePath("/", "layout");
  redirect(dest);
}
