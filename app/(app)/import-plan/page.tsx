import { requireUser } from "@/lib/auth";
import { ImportWizard } from "@/components/import-plan/import-wizard";

export default async function ImportPlanPage() {
  await requireUser();
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
