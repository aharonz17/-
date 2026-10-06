import Link from "next/link";
import { listEmployers } from "@/server/repo";
import { PageHead, Flash, type SP } from "@/components/ui";
import { PersonalFields, EmploymentFields, TaxFields } from "../fields";
import { createEmployeeAction } from "../actions";

export default async function NewEmployee({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const employers = listEmployers();
  if (!employers.length) {
    return (
      <>
        <PageHead title="עובד חדש" />
        <div className="card">כדי להוסיף עובד צריך קודם <Link href="/employers/new">ליצור מעסיק</Link>.</div>
      </>
    );
  }
  return (
    <>
      <PageHead title="עובד חדש" sub="כל הפרטים נשמרים במערכת; אפשר לעדכן אחר כך בכרטיס העובד." />
      <Flash sp={sp} />
      <form action={createEmployeeAction} className="stack card">
        <PersonalFields employers={employers} employerId={Number(sp.employer) || undefined} />
        <EmploymentFields />
        <TaxFields year={new Date().getFullYear()} />
        <div className="actions"><button className="btn" type="submit">יצירת עובד</button></div>
      </form>
    </>
  );
}
