/**
 * Deployment-skew detection.
 *
 * A long-lived browser tab runs the JS bundle from the deployment that was
 * live when the page first loaded ("own" id, baked in at build time via
 * NEXT_PUBLIC_DEPLOYMENT_ID). After a new production deploy, the deployment
 * currently serving requests ("live" id, from /api/version) differs — the
 * tab is stale and a client-side navigation can fail. We surface a
 * "reload to update" prompt rather than letting the user hit a broken state.
 *
 * Both ids must be present and non-empty to declare staleness: locally
 * (`next dev`) and when System Environment Variables are off, the ids are
 * empty, so we never nag when we can't actually tell.
 */
export function isClientStale(
  ownDeploymentId: string | null | undefined,
  liveDeploymentId: string | null | undefined,
): boolean {
  if (!ownDeploymentId || !liveDeploymentId) return false;
  return ownDeploymentId !== liveDeploymentId;
}
