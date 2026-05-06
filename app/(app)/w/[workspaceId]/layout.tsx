import { redirect } from "next/navigation";
import { getSessionToken, requireUser } from "@/lib/auth";
import { getWorkspace } from "@/lib/queries/workspaces";

// Single guard for every page under /w/<id>/*: if RLS hides the
// workspace row (membership revoked, or the id never existed for this
// user), bounce out to "/" with a notice the topnav toasts once.  Each
// child page can keep its own `notFound()` for sub-resources (epic,
// sprint, version) — those still mean "doesn't exist", not "evicted".
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireUser();
  const token = (await getSessionToken())!;
  const ws = await getWorkspace(token, workspaceId);
  if (!ws) redirect("/?notice=removed");
  return <>{children}</>;
}
