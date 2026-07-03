import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, getSessionToken } from "@/lib/auth";
import {
  getWorkspace,
  getWorkspaceRole,
  listMembers,
} from "@/lib/queries/workspaces";
import { WorkspaceSettingsForm } from "@/components/workspace/workspace-settings-form";
import { MemberList } from "@/components/workspace/member-list";
import { InviteMemberForm } from "@/components/workspace/invite-member-form";
import { VersionsPanel } from "@/components/versions/versions-panel";
import { WorkspaceCalendarPanel } from "@/components/workspace/workspace-calendar-panel";
import { listWorkspaceCalendar } from "@/lib/queries/workspace-holidays";
import { and, eq } from "drizzle-orm";
import { dbAsUser } from "@/lib/db/client";
import { links } from "@/lib/db/schema";

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) notFound();
  const [
    members,
    calendarRows,
    workspaceLinkRows,
    role,
  ] = await Promise.all([
      listMembers(token, workspaceId),
      listWorkspaceCalendar(token, workspaceId),
      dbAsUser(token, async (tx) => {
        return tx
          .select({ url: links.url, purpose: links.purpose })
          .from(links)
          .where(
            and(eq(links.workspaceId, workspaceId), eq(links.scope, "workspace")),
          );
      }).catch(() => [] as { url: string; purpose: "source" | "reports" }[]),
      getWorkspaceRole(token, workspaceId, user.id),
    ]);
  const workspaceLink =
    workspaceLinkRows.find((r) => r.purpose === "source") ?? null;
  const canDelete = role === "owner" || role === "admin";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-3 sm:px-4 md:px-6 py-6 md:py-8">
      <header className="space-y-2 border-b border-hairline pb-4">
        <div className="flex items-center gap-1.5 mono-meta-sm text-fg-faint">
          <Link href={`/w/${workspaceId}`} className="hover:text-fg">
            WORKSPACE
          </Link>
          <span>/</span>
          <span className="text-fg">SETTINGS</span>
        </div>
        <h1 className="font-sans text-2xl font-bold tracking-tight text-fg truncate">
          {ws.name}
        </h1>
      </header>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">WORKSPACE</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4">
          <WorkspaceSettingsForm
            workspace={{
              id: ws.id,
              name: ws.name,
              autoAssignCreator: ws.autoAssignCreator,
            }}
            workspaceLink={workspaceLink}
            canDelete={canDelete}
          />
        </div>
      </section>

      <section id="members" className="space-y-3 scroll-mt-20">
        <h2 className="mono-meta-sm text-fg-faint">MEMBERS</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4 space-y-4">
          <InviteMemberForm workspaceId={workspaceId} />
          <MemberList workspaceId={workspaceId} members={members} />
        </div>
      </section>

      <section id="calendar" className="space-y-3 scroll-mt-20">
        <h2 className="mono-meta-sm text-fg-faint">CALENDAR</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4">
          <WorkspaceCalendarPanel
            workspaceId={workspaceId}
            rows={calendarRows}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="mono-meta-sm text-fg-faint">VERSIONS</h2>
        <div className="rounded-xl border border-hairline bg-[color:var(--surface)] p-4">
          <VersionsPanel workspaceId={workspaceId} />
        </div>
      </section>
    </div>
  );
}
