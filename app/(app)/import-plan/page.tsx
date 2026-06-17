import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isImportPlanAllowed } from "@/lib/plan-import/access";
import { ImportWizard } from "@/components/import-plan/import-wizard";

export default async function ImportPlanPage() {
  const user = await requireUser();
  // Restricted feature: anyone off the allowlist gets a 404 (the page does not
  // reveal itself). See lib/plan-import/access.ts.
  if (!isImportPlanAllowed(user.email)) notFound();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Import a project plan</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Upload a project-plan PDF. We extract the work packages, tasks, deliverables and
        milestones; you review and edit them; then we build a new workspace.
      </p>
      <ImportWizard />
    </div>
  );
}
