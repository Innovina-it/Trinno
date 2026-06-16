import { logEvent } from "@/lib/observability/log";

// Receives Web Vitals beacons from components/system/web-vitals.tsx and writes
// them to the server log. sendBeacon posts as text, so we read the raw body
// and parse it defensively — a malformed beacon must never error the client.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const m = JSON.parse(await request.text()) as {
      name?: unknown;
      value?: unknown;
      rating?: unknown;
      id?: unknown;
      path?: unknown;
    };
    if (
      typeof m.name === "string" &&
      typeof m.value === "number" &&
      typeof m.id === "string"
    ) {
      logEvent({
        type: "web-vital",
        name: m.name,
        value: m.value,
        rating: typeof m.rating === "string" ? m.rating : undefined,
        id: m.id,
        path: typeof m.path === "string" ? m.path : undefined,
      });
    }
  } catch {
    // Malformed beacon — ignore.
  }
  return new Response(null, { status: 204 });
}
