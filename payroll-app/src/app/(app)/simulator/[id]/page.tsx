import Link from "next/link";
import { notFound } from "next/navigation";
import { getPayslipImport } from "@/server/payslip-import";
import { loadRuleVersions } from "@/server/rules";
import { listEmployers } from "@/server/repo";
import { PageHead, Flash, type SP } from "@/components/ui";
import { blankScenario, scenarioFromExtracted, type ActualValues } from "@/domain/payslip-import/scenario";
import { FIELD_LABELS, type ExtractedPayslip } from "@/domain/payslip-import/extract";
import { Simulator, type Identity } from "../Simulator";
import { saveAsEmployeeAction } from "../actions";

export default async function SimulatorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const rules = loadRuleVersions();
  const employers = listEmployers().map((e) => ({ id: e.id, name: e.name }));
  const now = new Date();

  if (id === "new") {
    const identity: Identity = { employerName: "", employerCompanyId: "", deductionsFile: "", firstName: "", lastName: "", idNumber: "", bankCode: "", branch: "", account: "", maritalStatus: "" };
    return (
      <>
        <PageHead title="סימולציה ריקה" sub="מזינים נתונים ורואים את התוצאה מיד." ><Link className="btn secondary" href="/simulator">חזרה</Link></PageHead>
        <Flash sp={sp} />
        <Simulator rules={rules} initial={blankScenario(now.getFullYear(), now.getMonth() + 1)} actual={{} as ActualValues} identity={identity}
          employers={employers} saveAction={saveAsEmployeeAction.bind(null, null)} savedEmployeeId={null} />
      </>
    );
  }

  const imp = getPayslipImport(Number(id));
  if (!imp) notFound();
  const f = imp.fields;
  const { scenario, actual } = scenarioFromExtracted(f, { year: now.getFullYear(), month: now.getMonth() + 1 });
  const initial = imp.scenario ?? scenario;
  const [firstName, ...rest] = (f.employeeName?.value ?? "").split(" ");
  const identity: Identity = {
    employerName: f.employerName?.value ?? "", employerCompanyId: f.employerCompanyId?.value ?? "", deductionsFile: f.deductionsFile?.value ?? "",
    firstName: firstName ?? "", lastName: rest.join(" "), idNumber: f.idNumber?.value ?? "", bankCode: f.bankCode?.value ?? "",
    branch: f.branch?.value ?? "", account: f.account?.value ?? "", maritalStatus: f.maritalStatus?.value ?? "",
  };
  const entries = (Object.keys(FIELD_LABELS) as (keyof ExtractedPayslip)[]).map((k) => [k, f[k]] as const);
  const found = entries.filter(([, v]) => v).length;

  const show = (v: unknown) => (v && typeof v === "object" && "year" in (v as object) ? `${(v as { month: number }).month}/${(v as { year: number }).year}` : String(v));

  return (
    <>
      <PageHead title={`סימולטור – ${f.employeeName?.value ?? imp.file_name}`} sub={<>{imp.file_name} · זוהו {found} מתוך {entries.length} שדות</>}>
        <Link className="btn secondary" href="/simulator">תלוש אחר</Link>
      </PageHead>
      <Flash sp={sp} />
      <Simulator rules={rules} initial={initial} actual={actual} identity={identity} employers={employers}
        saveAction={saveAsEmployeeAction.bind(null, imp.id)} savedEmployeeId={imp.employee_id} />
      <details className="card">
        <summary>מה זוהה בתלוש ({found} שדות)</summary>
        <table style={{ marginTop: "0.5rem" }}>
          <thead><tr><th>שדה</th><th>ערך</th><th>ודאות</th><th>שורה בתלוש</th></tr></thead>
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <td>{FIELD_LABELS[k]}</td>
                <td className="ltr">{v ? show(v.value) : <span className="muted">לא זוהה</span>}</td>
                <td>{v ? (v.confidence === "high" ? <span className="badge ok">גבוהה</span> : <span className="badge warn">לבדוק</span>) : ""}</td>
                <td className="small muted">{v?.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <details className="card">
        <summary>הטקסט שנקרא מהקובץ</summary>
        <pre className="small" style={{ whiteSpace: "pre-wrap", direction: "rtl" }}>{imp.lines.join("\n")}</pre>
      </details>
    </>
  );
}
