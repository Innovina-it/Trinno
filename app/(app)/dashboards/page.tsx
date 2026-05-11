import Link from "next/link";
import { requireUser, getSessionToken } from "@/lib/auth";
import { listDashboards } from "@/lib/queries/dashboards";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { CreateDashboardButton } from "@/components/dashboard/create-dashboard-dialog";
import { ChevronRight } from "lucide-react";

export default async function DashboardsPage() {
  await requireUser();
  const token = (await getSessionToken())!;
  const list = await listDashboards(token);
  const workspaces = await listWorkspaces(token);

  return (
    <div className="mx-auto max-w-3xl px-3 sm:px-4 md:px-6 py-6 md:py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 border-b border-hairline pb-4">
        <div className="space-y-1">
          <span className="mono-meta-sm text-fg-faint">
            {list.length === 0
              ? "NO DASHBOARDS"
              : `${list.length} ${list.length === 1 ? "DASHBOARD" : "DASHBOARDS"}`}
          </span>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-fg">
            Dashboards
          </h1>
        </div>
        <CreateDashboardButton
          workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
        />
      </header>

      {list.length === 0 ? (
        <div
          className="rounded-2xl border border-hairline bg-[color:var(--surface)] px-6 py-12 text-center space-y-2"
          data-testid="dashboards-list"
        >
          <p className="mono-meta-sm text-fg-faint">EMPTY</p>
          <p className="text-sm text-fg-muted">
            Use the New dashboard button to create one.
          </p>
        </div>
      ) : (
        <ul
          className="rounded-xl border border-hairline divide-y divide-hairline overflow-hidden"
          data-testid="dashboards-list"
        >
          {list.map((d) => (
            <li key={d.id}>
              <Link
                href={`/dashboards/${d.id}`}
                className="flex items-center gap-3 px-4 py-3 bg-[color:var(--surface)] hover:bg-[color:var(--surface-strong)] transition-colors group/dash"
              >
                <span className="mono-meta-sm text-fg-faint w-20 shrink-0">
                  {d.scope.toUpperCase()}
                </span>
                <span className="flex-1 font-sans text-sm font-medium text-fg truncate">
                  {d.name}
                </span>
                <ChevronRight className="size-4 text-fg-faint group-hover/dash:text-fg transition-colors" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
