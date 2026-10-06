import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccount, listImports, statementFor, SIM_TYPES } from "@/server/bank";
import { PageHead, Flash, Money, F, type SP } from "@/components/ui";
import { CATEGORY_LABELS, INTERNAL_CATEGORIES, type Category } from "@/domain/bank/categorize";
import { dateIL, ils, maskAccount } from "@/lib/format";
import { addSimAction, addTxnAction, deleteTxnAction, openingAction, setCategoryAction, undoImportAction } from "../actions";

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const acc = getAccount(Number(id));
  if (!acc) notFound();
  const from = typeof sp.from === "string" && sp.from ? sp.from : null;
  const to = typeof sp.to === "string" && sp.to ? sp.to : null;
  const st = statementFor(acc.id, from, to);
  const imports = listImports(acc.id);
  const sim = acc.kind === "SIMULATED";
  const byCat = new Map<Category, { credit: number; debit: number }>();
  for (const r of st.rows) {
    const c = (r as unknown as { category: Category }).category;
    const cur = byCat.get(c) ?? { credit: 0, debit: 0 };
    if (r.direction === "CREDIT") cur.credit += r.amount; else cur.debit += r.amount;
    byCat.set(c, cur);
  }

  return (
    <>
      {sim && <div className="sim-banner">חשבון הדמיה – הנתונים אינם נתוני בנק אמיתיים ואינם מסמך רשמי של בנק.</div>}
      <PageHead title={acc.holder} sub={<>{acc.bank_code} – {acc.bank_name} · סניף {acc.branch ?? "—"} · חשבון <span className="ltr">{maskAccount(acc.account_number)}</span></>}>
        {!sim && <Link className="btn" href={`/bank/${acc.id}/import`}>ייבוא קובץ מהבנק</Link>}
      </PageHead>
      <Flash sp={sp} />

      <form className="actions card no-print" method="get">
        <F label="מתאריך"><input type="date" name="from" defaultValue={from ?? ""} /></F>
        <F label="עד תאריך"><input type="date" name="to" defaultValue={to ?? ""} /></F>
        <button className="btn secondary" type="submit">הצג דף חשבון</button>
        {(from || to) && <Link href={`/bank/${acc.id}`} className="small">הכל</Link>}
      </form>

      <div className="grid grid-4">
        <div className="stat"><div className="v num">{ils(st.openingBalance)}</div><div className="k">יתרת פתיחה{st.from ? ` (${dateIL(st.from)})` : ""}</div></div>
        <div className="stat"><div className="v num" style={{ color: "var(--ok)" }}>{ils(st.totalCredits)}</div><div className="k">סה״כ זכות</div></div>
        <div className="stat"><div className="v num">{ils(st.totalDebits)}</div><div className="k">סה״כ חובה</div></div>
        <div className="stat"><div className="v num">{ils(st.closingBalance)}</div><div className="k">יתרת סגירה{st.to ? ` (${dateIL(st.to)})` : ""}</div></div>
      </div>
      <div className={`msg ${st.balanced ? "INFO" : "ERROR"}`} style={{ marginTop: "0.75rem" }}>
        בדיקה: {ils(st.openingBalance)} + {ils(st.totalCredits)} − {ils(st.totalDebits)} = {ils(st.closingBalance)}
        {st.reportedClosing !== null && <> · יתרה מדווחת אחרונה: {ils(st.reportedClosing)}</>}
        {st.balanced ? " ✓ תקין" : ` · ${st.errors.length} שורות שבהן היתרה המדווחת לא תואמת`}
      </div>
      {!st.balanced && (
        <div className="card table-wrap">
          <h3>שגיאות התאמה (Reconciliation)</h3>
          <table>
            <thead><tr><th>שורה</th><th className="num">יתרה צפויה</th><th className="num">יתרה מדווחת</th><th className="num">הפרש</th></tr></thead>
            <tbody>{st.errors.map((e) => <tr key={e.row}><td>{e.row}</td><td className="num">{ils(e.expected)}</td><td className="num">{ils(e.reported)}</td><td className="num">{ils(e.difference)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div className="card table-wrap">
        <h2>דף חשבון</h2>
        <table>
          <thead><tr><th>תאריך</th><th>ערך</th><th>תיאור</th><th>אסמכתא</th><th>קטגוריה</th><th className="num">חובה</th><th className="num">זכות</th><th className="num">יתרה</th><th></th></tr></thead>
          <tbody>
            <tr><td colSpan={7}><strong>יתרת פתיחה</strong></td><td className="num"><strong>{ils(st.openingBalance)}</strong></td><td></td></tr>
            {st.rows.map((r, i) => {
              const row = r as typeof r & { id: number; category: Category; source_format: string };
              return (
                <tr key={row.id} className={!r.reconciliation.ok ? "row-err" : ""}>
                  <td>{dateIL(r.transactionDate)}</td>
                  <td className="small muted">{r.valueDate && r.valueDate !== r.transactionDate ? dateIL(r.valueDate) : ""}</td>
                  <td>{r.description}{r.counterpartyName && <div className="small muted">{r.counterpartyName}</div>}</td>
                  <td className="ltr small">{r.reference}</td>
                  <td>
                    <form action={setCategoryAction.bind(null, acc.id, row.id)} className="no-print">
                      <select name="category" defaultValue={row.category} style={{ fontSize: "0.8rem", padding: "0.15rem" }}>
                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <button className="btn secondary small" type="submit" style={{ marginInlineStart: 4 }}>✓</button>
                    </form>
                    {INTERNAL_CATEGORIES.includes(row.category) && <span className="badge small">העברה פנימית</span>}
                  </td>
                  <td className="num">{r.direction === "DEBIT" ? ils(r.amount) : ""}</td>
                  <td className="num" style={{ color: "var(--ok)" }}>{r.direction === "CREDIT" ? ils(r.amount) : ""}</td>
                  <td className="num" title={r.reconciliation.reported !== null ? `מדווח: ${ils(r.reconciliation.reported)}` : "מחושב"}>
                    {ils(r.runningBalance)}{!r.reconciliation.ok && <div className="small" style={{ color: "var(--err)" }}>מדווח {ils(r.reconciliation.reported)}</div>}
                  </td>
                  <td className="no-print">{(sim || row.source_format === "MANUAL") && <form action={deleteTxnAction.bind(null, acc.id, row.id)}><button className="btn secondary small" type="submit" title={`מחיקת שורה ${i + 1}`}>✕</button></form>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={5}>יתרת סגירה</td><td className="num">{ils(st.totalDebits)}</td><td className="num">{ils(st.totalCredits)}</td><td className="num">{ils(st.closingBalance)}</td><td></td></tr></tfoot>
        </table>
      </div>

      {byCat.size > 0 && (
        <div className="card table-wrap">
          <h3>סיכום לפי קטגוריה</h3>
          <table>
            <thead><tr><th>קטגוריה</th><th className="num">זכות</th><th className="num">חובה</th></tr></thead>
            <tbody>{[...byCat.entries()].sort((a, b) => (b[1].credit + b[1].debit) - (a[1].credit + a[1].debit)).map(([c, v]) => (
              <tr key={c}><td>{CATEGORY_LABELS[c]} {INTERNAL_CATEGORIES.includes(c) && <span className="badge">לא נספר כהוצאה</span>}</td><td className="num"><Money v={v.credit} /></td><td className="num"><Money v={v.debit} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="grid grid-2 no-print">
        {sim ? (
          <div className="card">
            <h3>הוספת תנועת הדמיה</h3>
            <form action={addSimAction.bind(null, acc.id)} className="stack">
              <div className="fields">
                <F label="סוג">
                  <select name="type">
                    {SIM_TYPES.map((t) => <option key={t.key} value={t.key}>{t.desc} ({t.direction === "CREDIT" ? "זכות" : "חובה"})</option>)}
                    <option value="custom_credit">אחר – זכות</option><option value="custom_debit">אחר – חובה</option>
                  </select>
                </F>
                <F label="תאריך"><input type="date" name="date" required /></F>
                <F label="סכום (₪)"><input name="amount" inputMode="decimal" required /></F>
                <F label="תיאור (אופציונלי)"><input name="description" /></F>
              </div>
              <div><button className="btn" type="submit">הוספה</button></div>
            </form>
          </div>
        ) : (
          <div className="card">
            <h3>הוספת תנועה ידנית</h3>
            <form action={addTxnAction.bind(null, acc.id)} className="stack">
              <div className="fields">
                <F label="תאריך"><input type="date" name="transaction_date" required /></F>
                <F label="תאריך ערך"><input type="date" name="value_date" /></F>
                <F label="כיוון"><select name="direction"><option value="DEBIT">חובה</option><option value="CREDIT">זכות</option></select></F>
                <F label="סכום (₪)"><input name="amount" inputMode="decimal" required /></F>
                <F label="תיאור"><input name="description" required /></F>
                <F label="אסמכתא"><input name="reference" /></F>
                <F label="צד נגדי"><input name="counterparty_name" /></F>
                <F label="יתרה לאחר הפעולה"><input name="balance_after" inputMode="decimal" /></F>
              </div>
              <div><button className="btn" type="submit">הוספה</button></div>
            </form>
          </div>
        )}
        <div className="card">
          <h3>יתרת פתיחה של החשבון</h3>
          <form action={openingAction.bind(null, acc.id)} className="stack">
            <div className="fields">
              <F label="יתרה (₪)"><input name="opening_balance" inputMode="decimal" defaultValue={acc.opening_balance} /></F>
              <F label="נכון לתאריך"><input type="date" name="opening_date" defaultValue={acc.opening_date ?? ""} /></F>
            </div>
            <div><button className="btn secondary" type="submit">עדכון</button></div>
          </form>
          {imports.length > 0 && (
            <>
              <h3>קבצים שיובאו</h3>
              <table>
                <tbody>{imports.map((im) => (
                  <tr key={im.id}><td>{im.file_name}</td><td>{im.rows_imported} שורות</td><td>{im.status === "IMPORTED" ? <span className="badge ok">יובא</span> : <span className="badge">{im.status === "UNDONE" ? "בוטל" : "לא הושלם"}</span>}</td>
                    <td>{im.status === "IMPORTED" ? <form action={undoImportAction.bind(null, acc.id, im.id)}><button className="btn secondary small" type="submit">ביטול ייבוא</button></form>
                      : im.status === "UPLOADED" ? <Link href={`/bank/${acc.id}/import?import=${im.id}`}>המשך</Link> : null}</td></tr>
                ))}</tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </>
  );
}
