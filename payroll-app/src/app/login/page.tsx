import { redirect } from "next/navigation";
import { createUser, currentUser, login, userCount } from "@/server/auth";

export const dynamic = "force-dynamic";

async function loginAction(fd: FormData) {
  "use server";
  const u = String(fd.get("username") ?? ""), p = String(fd.get("password") ?? "");
  if (userCount() === 0) {
    if (p !== String(fd.get("password2") ?? "")) redirect("/login?e=match");
    try { createUser(u, p); } catch { redirect("/login?e=weak"); }
  }
  if (!(await login(u, p))) redirect("/login?e=bad");
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (await currentUser()) redirect("/");
  const { e } = await searchParams;
  const setup = userCount() === 0;
  const err = { bad: "שם משתמש או סיסמה שגויים.", match: "הסיסמאות אינן תואמות.", weak: "הסיסמה חייבת להכיל לפחות 8 תווים." }[e ?? ""];
  return (
    <main style={{ maxWidth: 380, margin: "10vh auto", padding: "0 16px" }}>
      <div className="card">
        <h1>{setup ? "הגדרת משתמש מנהל" : "כניסה למערכת"}</h1>
        <p className="muted small">{setup ? "זו הפעלה ראשונה. צרו משתמש וסיסמה – הם ישמשו לכניסה בהמשך." : "מערכת שכר ועו\"ש"}</p>
        {err && <div className="flash err">{err}</div>}
        <form action={loginAction} className="stack">
          <label className="f">שם משתמש<input name="username" required autoComplete="username" /></label>
          <label className="f">סיסמה<input name="password" type="password" required minLength={setup ? 8 : undefined} autoComplete={setup ? "new-password" : "current-password"} /></label>
          {setup && <label className="f">אימות סיסמה<input name="password2" type="password" required minLength={8} autoComplete="new-password" /></label>}
          <button className="btn" type="submit">{setup ? "יצירה וכניסה" : "כניסה"}</button>
        </form>
      </div>
    </main>
  );
}
