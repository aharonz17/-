import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmployer } from "@/server/repo";
import { getDb } from "@/server/db";
import { getTemplate, logoDataUri, removeLogo, saveLogo, saveTemplate } from "@/server/templates";
import { runAction } from "@/lib/action";
import { bool, str } from "@/lib/form";
import { CORE, EXTRA } from "@/domain/payroll/catalog";
import type { PayslipTemplate } from "@/pdf/payslip-html";
import { PageHead, Flash, F, type SP } from "@/components/ui";

const ALL = [...Object.values(CORE), ...Object.values(EXTRA)].sort((a, b) => a.code.localeCompare(b.code));

async function saveAction(employerId: number, fd: FormData) {
  "use server";
  await runAction(`/employers/${employerId}/template`, (actor) => {
    const codes: PayslipTemplate["codes"] = {};
    for (const c of ALL) {
      const code = str(fd, `code_${c.code}`), name = str(fd, `name_${c.code}`);
      if ((code && code !== c.code) || (name && name !== c.name)) codes[c.code] = { code: code ?? undefined, name: name ?? undefined };
    }
    const layout = str(fd, "layout");
    const color = str(fd, "color") ?? "#1f3b6b";
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("צבע לא תקין");
    saveTemplate(employerId, {
      layout: layout === "stacked" || layout === "compact" ? layout : "classic",
      color,
      showYtd: bool(fd, "show_ytd"),
      headerText: (str(fd, "header_text") ?? "").slice(0, 500) || undefined,
      footerText: (str(fd, "footer_text") ?? "").slice(0, 500) || undefined,
      codes,
    }, actor);
    return { ok: "התבנית נשמרה" };
  });
}

async function logoAction(employerId: number, fd: FormData) {
  "use server";
  await runAction(`/employers/${employerId}/template`, async (actor) => {
    const f = fd.get("logo");
    if (!(f instanceof File) || !f.size) throw new Error("בחרו קובץ תמונה");
    saveLogo(employerId, Buffer.from(await f.arrayBuffer()), actor);
    return { ok: "הלוגו נשמר" };
  });
}

async function removeLogoAction(employerId: number) {
  "use server";
  await runAction(`/employers/${employerId}/template`, (actor) => { removeLogo(employerId, actor); return { ok: "הלוגו הוסר" }; });
}

export default async function TemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const er = getEmployer(Number(id));
  if (!er) notFound();
  const t = getTemplate(er.id);
  const logo = logoDataUri(er.id);
  const last = getDb().prepare("SELECT id FROM payslips WHERE employer_id = ? ORDER BY id DESC LIMIT 1").get(er.id) as { id: number } | undefined;

  return (
    <>
      <PageHead title={`עיצוב תלוש – ${er.name}`} sub="התלוש יוצא בשם המעסיק ועם הלוגו שלו. השינוי חל על כל התלושים בתצוגה ובהדפסה – המספרים עצמם לא משתנים.">
        <Link className="btn secondary" href={`/employers/${er.id}`}>חזרה למעסיק</Link>
      </PageHead>
      <Flash sp={sp} />
      <div className="grid grid-2">
        <div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>לוגו המעסיק</h2>
            {logo ? (
              <div className="actions">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo} alt="לוגו" style={{ maxHeight: 60, maxWidth: 200, border: "1px solid var(--border)", padding: 4, background: "#fff" }} />
                <form action={removeLogoAction.bind(null, er.id)}><button className="btn secondary small" type="submit">הסרה</button></form>
              </div>
            ) : <p className="muted">אין לוגו.</p>}
            <form action={logoAction.bind(null, er.id)} className="actions" style={{ marginTop: "0.5rem" }}>
              <input type="file" name="logo" accept="image/png,image/jpeg" required style={{ maxWidth: 260 }} />
              <button className="btn small" type="submit">העלאה</button>
            </form>
            <p className="muted small">PNG או JPG עד 500KB. רק הלוגו של המעסיק עצמו.</p>
          </div>

          <form action={saveAction.bind(null, er.id)} className="card stack">
            <h2 style={{ marginTop: 0 }}>מראה</h2>
            <div className="fields">
              <F label="פריסה">
                <select name="layout" defaultValue={t.layout}>
                  <option value="classic">קלאסית – שני טורים</option>
                  <option value="stacked">בלוקים אחד מתחת לשני</option>
                  <option value="compact">מקוצרת (עמוד צפוף)</option>
                </select>
              </F>
              <F label="צבע ראשי"><input type="color" name="color" defaultValue={t.color} style={{ height: 38 }} /></F>
              <label className="check"><input type="checkbox" name="show_ytd" defaultChecked={t.showYtd} /> להציג מצטבר שנתי</label>
            </div>
            <F label="טקסט בראש התלוש (אופציונלי)" wide><textarea name="header_text" rows={2} defaultValue={t.headerText ?? ""} maxLength={500} /></F>
            <F label="טקסט בתחתית התלוש (אופציונלי)" wide><textarea name="footer_text" rows={2} defaultValue={t.footerText ?? ""} maxLength={500} /></F>

            <h2>קודי ושמות רכיבים</h2>
            <p className="muted small">אפשר לקבוע לכל רכיב את הקוד והשם שאתם רגילים אליהם. שדה ריק = ברירת המחדל.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>במערכת</th><th>קוד אצלי</th><th>שם אצלי</th></tr></thead>
                <tbody>
                  {ALL.map((c) => (
                    <tr key={c.code}>
                      <td className="small"><span className="ltr">{c.code}</span> · {c.name}</td>
                      <td><input name={`code_${c.code}`} defaultValue={t.codes[c.code]?.code ?? ""} placeholder={c.code} style={{ maxWidth: 90 }} /></td>
                      <td><input name={`name_${c.code}`} defaultValue={t.codes[c.code]?.name ?? ""} placeholder={c.name} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div><button className="btn" type="submit">שמירת התבנית</button></div>
          </form>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>תצוגה מקדימה</h2>
          {last ? (
            <>
              <p className="muted small">התלוש האחרון של המעסיק, עם התבנית השמורה. שמרו כדי לרענן.</p>
              <iframe src={`/api/payslips/${last.id}/html`} title="תצוגה מקדימה" style={{ width: "100%", height: 1100, border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }} />
            </>
          ) : <p className="muted">עוד אין תלושים למעסיק. אחרי הפקת התלוש הראשון התצוגה תופיע כאן.</p>}
        </div>
      </div>
    </>
  );
}
