import Link from "next/link";
import { requireUser, logout } from "@/server/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function logoutAction() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="shell">
      <aside className="side no-print">
        <div className="brand">מערכת שכר ועו״ש</div>
        <nav className="nav">
          <Link href="/">לוח בקרה</Link>
          <div className="label">שכר</div>
          <Link href="/employers">מעסיקים</Link>
          <Link href="/employees">עובדים</Link>
          <Link href="/payroll">הרצות שכר</Link>
          <Link href="/payslips">תלושים</Link>
          <Link href="/simulator">סימולטור (העלאת תלוש)</Link>
          <Link href="/payments">תשלומים</Link>
          <div className="label">בנק</div>
          <Link href="/bank">חשבונות בנק</Link>
          <Link href="/matching">התאמות שכר ↔ בנק</Link>
          <div className="sep" />
          <Link href="/reports">דוחות</Link>
          <Link href="/rules">כללי חישוב</Link>
          <Link href="/audit">יומן שינויים</Link>
          <div className="sep" />
          <form action={logoutAction} style={{ padding: "0.4rem 0.6rem" }}>
            <span className="muted small">{user.username} · </span>
            <button type="submit" className="btn secondary small">יציאה</button>
          </form>
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
