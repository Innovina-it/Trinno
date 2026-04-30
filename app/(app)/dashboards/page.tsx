import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listDashboards } from "@/lib/queries/dashboards";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { CreateDashboardButton } from "@/components/dashboard/create-dashboard-dialog";

export default async function DashboardsPage() {
  await requireUser();
  const token = (await getSessionToken())!;
  const list = await listDashboards(token);
  const workspaces = await listWorkspaces(token);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="serif-display text-3xl">Dashboards</h1>
          <p className="mono-meta-sm text-fg-muted mt-1">
            {list.length} TOTAL
          </p>
        </div>
        <CreateDashboardButton
          workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
        />
      </header>
      <ul
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        data-testid="dashboards-list"
      >
        {list.map((d) => (
          <li key={d.id}>
            <Link
              href={`/dashboards/${d.id}`}
              className="glass rounded-2xl p-5 block hover:-translate-y-0.5 transition-all"
            >
              <div className="mono-meta text-fg-faint">
                {d.scope.toUpperCase()}
              </div>
              <h2 className="serif-display text-2xl mt-2">{d.name}</h2>
            </Link>
          </li>
        ))}
        {list.length === 0 && (
          <li className="col-span-full text-center text-fg-muted py-20">
            <p className="pull-quote text-3xl">No dashboards yet.</p>
            <p className="mono-meta-sm mt-3">
              Use the button above to create one.
            </p>
          </li>
        )}
      </ul>
    </div>
  );
}
