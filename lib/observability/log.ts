// Structured observability events → one JSON line per event in the server
// log (queryable in Vercel logs, no logging dependency). Denial + slow-query
// are server-only; web-vital arrives via the /api/vitals route.
type ObservabilityEvent =
  | {
      type: "web-vital";
      name: string;
      value: number;
      rating?: string;
      id: string;
      path?: string;
    }
  | { type: "slow-query"; ms: number; thresholdMs: number }
  | { type: "denial"; code: string; message: string };

export function logEvent(event: ObservabilityEvent): void {
  const line = JSON.stringify({
    obs: true,
    ts: new Date().toISOString(),
    ...event,
  });
  // web-vital is informational; slow-query/denial are warnings worth surfacing.
  if (event.type === "web-vital") console.log(line);
  else console.warn(line);
}
