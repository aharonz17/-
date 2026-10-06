"use client";

import { useMemo, useState } from "react";
import { calculatePayroll, PayrollValidationError } from "@/domain/payroll/engine";
import { resolveRules } from "@/domain/rules/resolve";
import type { RuleVersion } from "@/domain/rules/types";
import type { PayrollResult } from "@/domain/payroll/types";
import { scenarioToInput, type ActualValues, type Scenario } from "@/domain/payslip-import/scenario";
import { TraceView } from "@/components/payroll-result";
import { ils, MONTHS } from "@/lib/format";

type Calc = { r: PayrollResult | null; error: string | null };

function calc(s: Scenario, rules: RuleVersion[]): Calc {
  try {
    const date = `${s.year}-${String(s.month).padStart(2, "0")}-01`;
    return { r: calculatePayroll(scenarioToInput(s), resolveRules(rules, date)), error: null };
  } catch (e) {
    return { r: null, error: e instanceof PayrollValidationError ? e.messages.filter((m) => m.level === "ERROR").map((m) => m.text).join(" · ") : (e as Error).message };
  }
}

const ROWS: { key: string; label: string; get: (r: PayrollResult) => number; actual?: keyof ActualValues; strong?: boolean; better?: "up" | "down" }[] = [
  { key: "gross", label: "ברוטו", get: (r) => r.totals.grossPay, actual: "gross" },
  { key: "taxable", label: "שכר חייב במס", get: (r) => r.bases.tax, actual: "taxable" },
  { key: "tax", label: "מס הכנסה", get: (r) => r.tax.incomeTax, actual: "incomeTax", better: "down" },
  { key: "ni", label: "ביטוח לאומי", get: (r) => r.ni.employee, actual: "nationalInsurance", better: "down" },
  { key: "health", label: "מס בריאות", get: (r) => r.ni.health, actual: "health", better: "down" },
  { key: "pension", label: "פנסיה עובד", get: (r) => r.pension.employee, actual: "pensionEmployee" },
  { key: "sf", label: "קרן השתלמות עובד", get: (r) => r.studyFund.employee, actual: "studyFundEmployee" },
  { key: "ded", label: "סה״כ ניכויים", get: (r) => r.totals.totalDeductions, actual: "totalDeductions", better: "down" },
  { key: "net", label: "נטו לתשלום", get: (r) => r.totals.netToPay, actual: "netToPay", strong: true, better: "up" },
  { key: "erPension", label: "פנסיה מעסיק (תגמולים)", get: (r) => r.pension.employer, actual: "pensionEmployer" },
  { key: "sev", label: "פיצויים", get: (r) => r.pension.severance, actual: "severance" },
  { key: "cost", label: "עלות מעסיק", get: (r) => r.totals.employerCost },
  { key: "marginal", label: "מס שולי", get: (r) => r.tax.marginalRate * 100 },
];

export type Identity = {
  employerName: string; employerCompanyId: string; deductionsFile: string; firstName: string; lastName: string; idNumber: string;
  bankCode: string; branch: string; account: string; maritalStatus: string;
};

export function Simulator({ rules, initial, actual, identity, employers, saveAction, savedEmployeeId }: {
  rules: RuleVersion[]; initial: Scenario; actual: ActualValues; identity: Identity; employers: { id: number; name: string }[];
  saveAction: (fd: FormData) => Promise<void>; savedEmployeeId: number | null;
}) {
  const [base, setBase] = useState<Scenario>(initial);
  const [s, setS] = useState<Scenario>(initial);
  const [showTrace, setShowTrace] = useState(false);
  const baseCalc = useMemo(() => calc(base, rules), [base, rules]);
  const cur = useMemo(() => calc(s, rules), [s, rules]);
  const hasActual = Object.keys(actual).length > 0;

  const set = <K extends keyof Scenario>(k: K, v: Scenario[K]) => setS((p) => ({ ...p, [k]: v }));
  const numIn = (k: keyof Scenario, label: string, step = "any") => (
    <label className="f">{label}
      <input type="number" step={step} inputMode="decimal" value={Number.isFinite(s[k] as number) ? String(s[k]) : ""}
        onChange={(e) => set(k, (e.target.value === "" ? 0 : Number(e.target.value)) as never)} />
    </label>
  );
  const changed = (k: keyof Scenario) => s[k] !== base[k];
  const nChanged = (Object.keys(s) as (keyof Scenario)[]).filter(changed).length;

  const quick: [string, (p: Scenario) => Partial<Scenario>][] = [
    ["שכר +500", (p) => (p.payType === "monthly" ? { baseSalary: p.baseSalary + 500 } : { hourlyRate: p.hourlyRate + 3 })],
    ["שכר +1,000", (p) => (p.payType === "monthly" ? { baseSalary: p.baseSalary + 1000 } : { hourlyRate: p.hourlyRate + 6 })],
    ["העלאה 10%", (p) => (p.payType === "monthly" ? { baseSalary: Math.round(p.baseSalary * 1.1) } : { hourlyRate: +(p.hourlyRate * 1.1).toFixed(2) })],
    ["+10 ש״נ 125%", (p) => ({ ot125: p.ot125 + 10 })],
    ["בונוס 2,000", (p) => ({ bonus: p.bonus + 2000 })],
    ["+1 נקודת זיכוי", (p) => ({ creditPoints: +(p.creditPoints + 1).toFixed(2) })],
    ["קרן השתלמות", () => ({ studyFundEnabled: true })],
  ];

  const diffCell = (a: number | undefined, b: number | undefined, better?: "up" | "down") => {
    if (a === undefined || b === undefined) return <td className="num muted">—</td>;
    const d = Math.round((b - a) * 100) / 100;
    if (Math.abs(d) < 0.005) return <td className="num muted">0</td>;
    const good = better ? (better === "up" ? d > 0 : d < 0) : null;
    return <td className="num" style={{ color: good === null ? undefined : good ? "var(--ok)" : "var(--err)", fontWeight: 600 }}>{d > 0 ? "+" : ""}{ils(d)}</td>;
  };

  return (
    <>
      <div className="card">
        <div className="page-head" style={{ marginBottom: "0.5rem" }}>
          <h2 style={{ margin: 0 }}>תוצאות</h2>
          <div className="actions">
            {nChanged > 0 && <span className="badge info">{nChanged} שינויים מהבסיס</span>}
            <button type="button" className="btn secondary small" onClick={() => setS(base)} disabled={!nChanged}>חזרה לבסיס</button>
            <button type="button" className="btn secondary small" onClick={() => setBase(s)} disabled={!nChanged} title="התרחיש הנוכחי יהפוך לבסיס ההשוואה">קבע כבסיס</button>
          </div>
        </div>
        {cur.error && <div className="msg ERROR">{cur.error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                {hasActual && <th className="num">בתלוש המקורי</th>}
                <th className="num">חישוב המערכת – בסיס</th>
                {hasActual && <th className="num">פער מהתלוש</th>}
                <th className="num">תרחיש נוכחי</th>
                <th className="num">שינוי מהבסיס</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const a = row.actual ? actual[row.actual] : undefined;
                const b = baseCalc.r ? row.get(baseCalc.r) : undefined;
                const c = cur.r ? row.get(cur.r) : undefined;
                const pct = row.key === "marginal";
                const fmt = (v: number | undefined) => (v === undefined ? "—" : pct ? `${v.toFixed(0)}%` : ils(v));
                return (
                  <tr key={row.key} style={row.strong ? { fontWeight: 700, background: "var(--ok-soft)" } : undefined}>
                    <td>{row.label}</td>
                    {hasActual && <td className="num">{a === undefined ? <span className="muted">לא זוהה</span> : ils(a)}</td>}
                    <td className="num">{fmt(b)}</td>
                    {hasActual && (a === undefined || b === undefined ? <td className="num muted">—</td>
                      : Math.abs(b - a) < 0.02 ? <td className="num" style={{ color: "var(--ok)" }}>✓</td>
                      : <td className="num" style={{ color: "var(--warn)" }}>{b - a > 0 ? "+" : ""}{ils(b - a)}</td>)}
                    <td className="num"><strong>{fmt(c)}</strong></td>
                    {pct ? <td className="num">{b !== undefined && c !== undefined && b !== c ? `${(c - b).toFixed(0)}%` : <span className="muted">0</span>}</td> : diffCell(b, c, row.better)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hasActual && baseCalc.r && actual.netToPay !== undefined && Math.abs(baseCalc.r.totals.netToPay - actual.netToPay) >= 0.02 && (
          <div className="msg WARNING">יש פער בין החישוב לתלוש המקורי. בדקו בטופס למטה שהנתונים שזוהו נכונים (שכר, נקודות זיכוי, פנסיה, רכיבים נוספים) – לאחר תיקון לחצו &quot;קבע כבסיס&quot;.</div>
        )}
        <div className="actions" style={{ marginTop: "0.75rem" }}>
          <span className="muted small">מה אם…</span>
          {quick.map(([label, fn]) => <button key={label} type="button" className="btn secondary small" onClick={() => setS((p) => ({ ...p, ...fn(p) }))}>{label}</button>)}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>נתונים (שנו כל שדה – התוצאה מתעדכנת מיד)</h2>
        <fieldset>
          <legend>תקופה ועובד</legend>
          <div className="fields">
            <label className="f">חודש<select value={s.month} onChange={(e) => set("month", Number(e.target.value))}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select></label>
            {numIn("year", "שנת מס", "1")}
            <label className="f">מגדר<select value={s.gender} onChange={(e) => set("gender", e.target.value as "male")}><option value="male">גבר</option><option value="female">אישה</option></select></label>
            <label className="f">תאריך לידה<input type="date" value={s.birthDate} onChange={(e) => set("birthDate", e.target.value)} /></label>
            <label className="f">תחילת עבודה<input type="date" value={s.startDate} onChange={(e) => set("startDate", e.target.value)} /></label>
            <label className="f">מגזר<select value={s.sector} onChange={(e) => set("sector", e.target.value as "private")}><option value="private">פרטי</option><option value="public">ציבורי</option></select></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>שכר</legend>
          <div className="fields">
            <label className="f">סוג שכר<select value={s.payType} onChange={(e) => set("payType", e.target.value as "monthly")}><option value="monthly">חודשי</option><option value="hourly">שעתי</option></select></label>
            {s.payType === "monthly" ? numIn("baseSalary", "שכר בסיס (₪)") : <>{numIn("hourlyRate", "תעריף לשעה (₪)")}{numIn("hours", "שעות רגילות")}</>}
            {numIn("jobPercent", "היקף משרה (%)")}
            {numIn("workDays", "ימי עבודה")}
            {numIn("creditPoints", "נקודות זיכוי", "0.25")}
          </div>
        </fieldset>
        <fieldset>
          <legend>רכיבים נוספים</legend>
          <div className="fields">
            {numIn("ot125", "ש״נ 125% (שעות)")}
            {numIn("ot150", "ש״נ 150% (שעות)")}
            {numIn("travel", "נסיעות (₪)")}
            {numIn("recovery", "הבראה (₪)")}
            {numIn("bonus", "בונוס (₪)")}
            {numIn("otherEarnings", "רכיבים אחרים (₪, שלילי = ניכוי היעדרות)")}
            {numIn("carBenefit", "שווי רכב (₪)")}
          </div>
        </fieldset>
        <fieldset>
          <legend>פנסיה וקרן השתלמות</legend>
          <div className="fields">
            <label className="check"><input type="checkbox" checked={s.pensionEnabled} onChange={(e) => set("pensionEnabled", e.target.checked)} /> פנסיה</label>
            {numIn("pensionEmployee", "עובד (%)")}
            {numIn("pensionEmployer", "מעסיק (%)")}
            {numIn("severance", "פיצויים (%)")}
            <label className="check"><input type="checkbox" checked={s.studyFundEnabled} onChange={(e) => set("studyFundEnabled", e.target.checked)} /> קרן השתלמות</label>
            {numIn("studyFundEmployee", "השתלמות עובד (%)")}
            {numIn("studyFundEmployer", "השתלמות מעסיק (%)")}
          </div>
        </fieldset>
        <p className="muted small">שדות ששונו מהבסיס: {(Object.keys(s) as (keyof Scenario)[]).filter(changed).join(", ") || "אין"}</p>
      </div>

      {cur.r && (
        <div className="card">
          <button type="button" className="btn secondary small" onClick={() => setShowTrace((x) => !x)}>{showTrace ? "הסתרת" : "הצגת"} &quot;כיצד חושב?&quot; לתרחיש הנוכחי</button>
          {showTrace && <div style={{ marginTop: "0.75rem" }}><TraceView r={cur.r} /></div>}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>שמירה כעובד במערכת</h2>
        {savedEmployeeId ? (
          <p>מתלוש זה כבר נוצר עובד: <a href={`/employees/${savedEmployeeId}`}>לכרטיס העובד</a></p>
        ) : (
          <form action={saveAction} className="stack">
            <p className="muted small">יוצר עובד (ומעסיק אם צריך) עם נתוני התרחיש הנוכחי. אחר כך אפשר להריץ לו שכר רגיל ולהשלים פרטים בכרטיס העובד.</p>
            <input type="hidden" name="scenario" value={JSON.stringify(s)} />
            <div className="fields">
              <label className="f">מעסיק
                <select name="employer_id" defaultValue="">
                  <option value="">חדש (לפי הפרטים מימין) / זיהוי אוטומטי</option>
                  {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
              <label className="f">שם מעסיק<input name="employer_name" defaultValue={identity.employerName} /></label>
              <label className="f">ח.פ<input name="employer_company_id" defaultValue={identity.employerCompanyId} /></label>
              <label className="f">תיק ניכויים<input name="deductions_file" defaultValue={identity.deductionsFile} /></label>
              <label className="f">שם פרטי *<input name="first_name" required defaultValue={identity.firstName} /></label>
              <label className="f">שם משפחה *<input name="last_name" required defaultValue={identity.lastName} /></label>
              <label className="f">ת.ז *<input name="id_number" required defaultValue={identity.idNumber} inputMode="numeric" /></label>
              <label className="f">קוד בנק<input name="bank_code" defaultValue={identity.bankCode} /></label>
              <label className="f">סניף<input name="branch" defaultValue={identity.branch} /></label>
              <label className="f">חשבון<input name="account" defaultValue={identity.account} /></label>
              <input type="hidden" name="marital_status" value={identity.maritalStatus} />
            </div>
            <div><button className="btn" type="submit">שמירה כעובד</button></div>
          </form>
        )}
      </div>
    </>
  );
}
