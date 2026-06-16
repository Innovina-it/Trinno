"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Top-level error boundary for the app's page segments. Catches render
 * and data errors thrown below the root layout so an uncaught crash shows
 * a recoverable screen (Try again / Home) instead of a blank page. The
 * root layout — and ErrorPane — stay mounted around this. A crash in the
 * root layout itself falls through to app/global-error.tsx.
 *
 * Kept dependency-light on purpose: if a shared component is what crashed,
 * the error screen must not re-import it.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console / observability. `digest` correlates with the
    // server-side log entry for this error when one exists.
    console.error("Unhandled app error:", error);
  }, [error]);

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-[color:var(--hairline-hi)] bg-[color:var(--surface-strong)] p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/30">
          <AlertTriangle className="size-5 text-red-300" />
        </div>
        <h1 className="text-lg font-semibold text-fg">Something went wrong</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          This part of the app hit an unexpected error. Your data is safe — try
          again, or head back home.
        </p>
        {error.digest && (
          <p className="mono-meta-sm mt-3 text-fg-faint">Ref: {error.digest}</p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            data-testid="error-boundary-retry"
            className="inline-flex items-center gap-1.5 rounded-md bg-fg/15 px-3 py-1.5 text-sm font-medium text-fg ring-1 ring-fg/30 hover:bg-fg/20 transition-colors"
          >
            <RefreshCw className="size-3.5" />
            Try again
          </button>
          <Link
            href="/"
            data-testid="error-boundary-home"
            className="inline-flex items-center rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg hover:bg-[rgb(255_255_255/0.06)] transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
