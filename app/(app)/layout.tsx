import { headers } from "next/headers";
import { requireUser, getSessionToken } from "@/lib/auth";
import { TopNav } from "@/components/nav/top-nav";
import { listWorkspaces } from "@/lib/queries/workspaces";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);

  const h = await headers();
  const path = h.get("x-pathname") ?? "";
  const m = path.match(/^\/w\/([0-9a-f-]{36})/);
  const activeWorkspaceId = m ? m[1] : undefined;

  return (
    <>
      <TopNav
        email={user.email ?? ""}
        userId={user.id}
        workspaces={ws.map(w => ({ id: w.id, name: w.name }))}
        activeWorkspaceId={activeWorkspaceId}
      />
      <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
    </>
  );
}
