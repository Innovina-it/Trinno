// Pre-prod indicator. Renders a small fixed pill on non-production Vercel
// deploys so testers know they are on a preview/pre-prod build (and which
// branch). Hidden in local dev (VERCEL_ENV undefined) and on production.
export function EnvBadge() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (!vercelEnv || vercelEnv === "production") return null;

  const ref = process.env.VERCEL_GIT_COMMIT_REF;
  const label = vercelEnv === "preview" ? "PRE-PROD" : vercelEnv.toUpperCase();

  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-50 select-none rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[10px] font-medium tracking-wide text-amber-600 backdrop-blur dark:text-amber-400">
      {label}
      {ref ? ` · ${ref}` : ""}
    </div>
  );
}
