import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { requireUser, getSessionToken } from "@/lib/auth";
import { TopNav } from "@/components/nav/top-nav";
import { TourOverlay } from "@/components/onboarding/tour-overlay";
import { listWorkspaces } from "@/lib/queries/workspaces";
import { listFavoriteBoards } from "@/lib/queries/favorites";
import { dbAsUser } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const token = (await getSessionToken())!;
  const ws = await listWorkspaces(token);

  const h = await headers();
  const path = h.get("x-pathname") ?? "";
  const m = path.match(/^\/w\/([0-9a-f-]{36})/);
  const activeWorkspaceId = m ? m[1] : undefined;

  // Plan #16b-γ-B (#7) — fetch the onboarding flag so we can decide
  // whether to render the first-run tour. On any error (RLS, transient DB
  // hiccup) default to "completed" so we never accidentally pin the
  // overlay to the user's screen forever.
  let onboardingCompletedAt: Date | null = new Date();
  try {
    const [row] = await dbAsUser(token, async (tx) =>
      tx
        .select({
          onboardingCompletedAt: profiles.onboardingCompletedAt,
        })
        .from(profiles)
        .where(eq(profiles.id, user.id)),
    );
    onboardingCompletedAt = row?.onboardingCompletedAt ?? null;
  } catch {
    // Leave default (non-null) so the tour stays hidden.
  }

  const showTour = onboardingCompletedAt === null && ws.length > 0;

  // Plan #16b-γ-C (#4) — favorites are surfaced in the top nav so the
  // user can jump cross-workspace. Best-effort: any RLS hiccup falls
  // back to an empty list.
  let favorites: Awaited<ReturnType<typeof listFavoriteBoards>> = [];
  try {
    favorites = await listFavoriteBoards(token);
  } catch {
    favorites = [];
  }

  return (
    <>
      <TopNav
        email={user.email ?? ""}
        userId={user.id}
        workspaces={ws.map(w => ({ id: w.id, name: w.name }))}
        activeWorkspaceId={activeWorkspaceId}
        favorites={favorites}
      />
      <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
      {showTour && <TourOverlay />}
    </>
  );
}
