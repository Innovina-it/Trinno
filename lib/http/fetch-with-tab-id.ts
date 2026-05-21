import { getTabId, TAB_ID_HEADER } from "@/lib/auth/tab-id";

const SAME_ORIGIN_MARKER = Symbol.for("trinno.fetch-with-tab-id.installed");

type FetchFn = typeof fetch;

function isSameOriginUrl(input: RequestInfo | URL): boolean {
  if (typeof window === "undefined") return false;
  try {
    let urlString: string;
    if (typeof input === "string") urlString = input;
    else if (input instanceof URL) urlString = input.toString();
    else if (input instanceof Request) urlString = input.url;
    else return false;

    if (urlString.startsWith("/") && !urlString.startsWith("//")) return true;
    const parsed = new URL(urlString, window.location.href);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

function isHeaderInjectionEnabled() {
  return process.env.NEXT_PUBLIC_TAB_ID_HEADER !== "false";
}

export function fetchWithTabId(
  originalFetch: FetchFn,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isHeaderInjectionEnabled()) {
    return originalFetch(input, init);
  }

  if (!isSameOriginUrl(input)) {
    return originalFetch(input, init);
  }

  const tabId = getTabId();
  if (!tabId) {
    return originalFetch(input, init);
  }

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has(TAB_ID_HEADER)) {
    headers.set(TAB_ID_HEADER, tabId);
  }

  const nextInit: RequestInit = { ...init, headers };
  return originalFetch(input, nextInit);
}

export function installTabIdInterceptor(): void {
  if (typeof window === "undefined") return;

  const w = window as typeof window & { [SAME_ORIGIN_MARKER]?: boolean };
  if (w[SAME_ORIGIN_MARKER]) return;
  w[SAME_ORIGIN_MARKER] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithTabId(originalFetch, input, init)) as FetchFn;
}
