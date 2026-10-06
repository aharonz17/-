import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccount, getImport, importGrid, previewImport, listSavedMappings } from "@/server/bank";
import { json } from "@/server/db";
import { PageHead, Flash, F, type SP } from "@/components/ui";
import { CANONICAL_FIELDS, type CanonicalField, type Cell, type DateFormat, type Mapping } from "@/domain/bank/import";
import { dateIL, ils } from "@/lib/format";
import { commitAction, previewAction, uploadAction } from "../../actions";

const cellText = (c: Cell) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));

export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const acc = getAccount(Number(id));
  if (!acc) notFound();
  const importId = Number(sp.import) || null;
  const imp = importId ? getImport(importId) : undefined;

  if (!imp) {
    const saved = listSavedMappings();
    return (
      <>
        <PageHead title={`ייבוא דף חשבון – ${acc.holder}`} sub="שלב 1: העלאת קובץ" />
        <Flash sp={sp} />
        <div className="card">
          <form action={uploadAction.bind(null, acc.id)} className="stack">
            <F label="קובץ Excel (xlsx), CSV, או קובץ xls שהורד מאתר הבנק">
              <input type="file" name="file" accept=".xlsx,.xls,.csv,.txt,.html,.htm" required />
            </F>
            <p className="muted small">אין צורך שהעמודות ייקראו בשם מסוים – בשלב הבא ממפים כל עמודה לשדה. קידוד עברית (UTF-8 / windows-1255) מזוהה אוטומטית. לא נדרשת סיסמת בנק.</p>
            <div><button className="btn" type="submit">העלאה</button></div>
          </form>
        </div>
        {saved.length > 0 && (
          <div className="card"><h3>תבניות מיפוי שמורות</h3><p className="muted small">קובץ עם אותן כותרות ימופה אוטומטית:</p>
            <ul>{saved.map((s) => <li key={s.id}>{s.name}</li>)}</ul></div>
        )}
      </>
    );
  }

  const grid = await importGrid(imp.id);
  const headerRow = sp.h !== undefined ? Number(sp.h) : imp.header_row ?? 0;
  const mapping: Mapping = sp.m ? json<Mapping>(String(sp.m), {}) : json<Mapping>(imp.mapping_json, {});
  const fmt = (typeof sp.f === "string" ? sp.f : imp.date_format ?? "auto") as DateFormat;
  const headers = grid[headerRow] ?? [];
  const width = Math.max(...grid.slice(0, 40).map((r) => r.length), 0);
  const preview = sp.preview ? await previewImport(imp.id, headerRow, mapping, fmt) : null;
  const done = imp.status === "IMPORTED";

  const mappingFields = (
    <>
      <input type="hidden" name="header_row" value={headerRow + 1} />
      {Object.entries(mapping).map(([k, v]) => <input key={k} type="hidden" name={`map_${k}`} value={v} />)}
      <input type="hidden" name="date_format" value={fmt} />
    </>
  );

  return (
    <>
      <PageHead title={`ייבוא: ${imp.file_name}`} sub={`${acc.holder} · ${imp.file_type.toUpperCase()} · ${grid.length} שורות בקובץ`}>
        <Link className="btn secondary" href={`/bank/${acc.id}/import`}>קובץ אחר</Link>
      </PageHead>
      <Flash sp={sp} />
      {sp.dup && <div className="msg WARNING">קובץ זהה כבר יובא לחשבון זה. ייבוא נוסף ייצור תנועות כפולות.</div>}
      {sp.saved && <div className="msg INFO">זוהתה תבנית מיפוי שמורה עבור כותרות הקובץ – המיפוי מולא אוטומטית.</div>}
      {done && <div className="msg INFO">קובץ זה כבר יובא. <Link href={`/bank/${acc.id}`}>לדף החשבון</Link></div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>שלב 2: מיפוי עמודות</h2>
        <form action={previewAction.bind(null, acc.id, imp.id)} className="stack">
          <div className="fields">
            <F label="שורת הכותרות (מספר שורה בקובץ)"><input name="header_row" inputMode="numeric" defaultValue={headerRow + 1} /></F>
            <F label="פורמט תאריך">
              <select name="date_format" defaultValue={fmt}><option value="auto">אוטומטי (יום/חודש/שנה)</option><option value="DMY">יום/חודש/שנה</option><option value="MDY">חודש/יום/שנה</option></select>
            </F>
          </div>
          <div className="fields">
            {(Object.keys(CANONICAL_FIELDS) as CanonicalField[]).map((k) => (
              <F key={k} label={CANONICAL_FIELDS[k]}>
                <select name={`map_${k}`} defaultValue={mapping[k] ?? ""}>
                  <option value="">— לא ממופה —</option>
                  {Array.from({ length: width }, (_, i) => <option key={i} value={i}>עמודה {i + 1}{cellText(headers[i]) ? `: ${cellText(headers[i])}` : ""}</option>)}
                </select>
              </F>
            ))}
          </div>
          <p className="muted small">חובה: תאריך פעולה, ועמודת סכום אחת או זוג חובה/זכות. מומלץ: יתרה – לבדיקת התאמה שורה-שורה.</p>
          <div><button className="btn" type="submit">תצוגה מקדימה ובדיקה</button></div>
        </form>
      </div>

      {!preview && (
        <div className="card table-wrap">
          <h3>הקובץ כפי שהתקבל (20 שורות ראשונות)</h3>
          <table>
            <tbody>
              {grid.slice(0, 20).map((row, r) => (
                <tr key={r} style={r === headerRow ? { fontWeight: 700, background: "var(--primary-soft)" } : undefined}>
                  <td className="muted small">{r + 1}</td>
                  {Array.from({ length: width }, (_, i) => <td key={i} className="small">{cellText(row[i])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>שלב 3: תצוגה מקדימה ובדיקה</h2>
            <div className="grid grid-4">
              <div className="stat"><div className="v">{preview.txns.length}</div><div className="k">תנועות לייבוא</div></div>
              <div className="stat"><div className="v num">{ils(preview.statement.openingBalance)}</div><div className="k">יתרת פתיחה {preview.openingBalance !== null ? "(מהקובץ)" : "(מחושבת)"}</div></div>
              <div className="stat"><div className="v num">{ils(preview.statement.closingBalance)}</div><div className="k">יתרת סגירה</div></div>
              <div className="stat"><div className="v">{preview.statement.balanced ? "✓" : `${preview.statement.errors.length} ✕`}</div><div className="k">התאמת יתרות</div></div>
            </div>
            {preview.issues.filter((i) => i.level !== "INFO").slice(0, 30).map((i, k) => <div key={k} className={`msg ${i.level}`}>{i.row ? `שורה ${i.row}: ` : ""}{i.message}</div>)}
            {preview.issues.filter((i) => i.level === "INFO").map((i, k) => <div key={k} className="msg INFO">{i.row ? `שורה ${i.row}: ` : ""}{i.message}</div>)}
            {preview.statement.errors.slice(0, 10).map((e) => <div key={e.row} className="msg ERROR">תנועה {e.row}: יתרה צפויה {ils(e.expected)}, בקובץ {ils(e.reported)} (הפרש {ils(e.difference)})</div>)}
            {!done && (
              <form action={commitAction.bind(null, acc.id, imp.id)} className="stack" style={{ marginTop: "1rem" }}>
                {mappingFields}
                <div className="fields">
                  <F label="שמירת המיפוי כתבנית (שם, אופציונלי)"><input name="save_as" placeholder={`${acc.bank_name ?? "בנק"} – ייצוא עו״ש`} /></F>
                  <label className="check"><input type="checkbox" name="set_opening" defaultChecked={acc.opening_balance === 0} /> לקבוע את יתרת הפתיחה של החשבון לפי הקובץ</label>
                </div>
                <div><button className="btn" type="submit" disabled={!preview.txns.length}>שלב 4: ייבוא {preview.txns.length} תנועות</button></div>
              </form>
            )}
          </div>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>שורה</th><th>תאריך</th><th>ערך</th><th>תיאור</th><th>אסמכתא</th><th className="num">חובה</th><th className="num">זכות</th><th className="num">יתרה בקובץ</th><th className="num">יתרה מחושבת</th></tr></thead>
              <tbody>
                {preview.statement.rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className={r.reconciliation.ok ? "" : "row-err"}>
                    <td className="muted small">{preview.txns[i].rowNumber}</td>
                    <td>{dateIL(r.transactionDate)}</td><td className="small">{dateIL(r.valueDate)}</td><td>{r.description}</td><td className="ltr small">{r.reference}</td>
                    <td className="num">{r.direction === "DEBIT" ? ils(r.amount) : ""}</td><td className="num">{r.direction === "CREDIT" ? ils(r.amount) : ""}</td>
                    <td className="num">{ils(r.balanceAfter)}</td><td className="num">{ils(r.runningBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
