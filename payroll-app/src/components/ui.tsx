import Link from "next/link";
import type { Message } from "@/domain/payroll/types";
import { ils } from "@/lib/format";

export type SP = Promise<Record<string, string | string[] | undefined>>;

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const err = typeof sp.err === "string" ? sp.err : null;
  return (
    <>
      {ok && <div className="flash ok" role="status">{ok}</div>}
      {err && <div className="flash err" role="alert">{err}</div>}
    </>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="muted">{sub}</div>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Messages({ list }: { list: Message[] }) {
  if (!list.length) return null;
  const order = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
  return (
    <div>
      {[...list].sort((a, b) => order[a.level] - order[b.level]).map((m, i) => (
        <div key={i} className={`msg ${m.level}`}>
          <strong>{m.level === "ERROR" ? "שגיאה" : m.level === "WARNING" ? "אזהרה" : "מידע"}:</strong> {m.text}
        </div>
      ))}
    </div>
  );
}

export function Money({ v, strong }: { v: number | null | undefined; strong?: boolean }) {
  const s = <span className="num">{ils(v)}</span>;
  return strong ? <strong>{s}</strong> : s;
}

export function Stat({ k, v, href }: { k: string; v: React.ReactNode; href?: string }) {
  const body = (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
  return href ? <Link href={href} style={{ color: "inherit", textDecoration: "none" }}>{body}</Link> : body;
}

export function F({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`f${wide ? " wide" : ""}`}>{label}{children}</label>;
}
