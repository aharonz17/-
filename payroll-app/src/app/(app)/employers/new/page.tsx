import { PageHead, Flash, type SP } from "@/components/ui";
import { EmployerForm } from "../EmployerForm";
import { createEmployerAction } from "../actions";

export default async function NewEmployer({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <>
      <PageHead title="מעסיק חדש" />
      <Flash sp={sp} />
      <div className="card"><EmployerForm action={createEmployerAction} submit="יצירת מעסיק" /></div>
    </>
  );
}
