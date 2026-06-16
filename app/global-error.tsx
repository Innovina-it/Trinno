"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import "./globals.css";

/**
 * Last-resort error boundary. Catches errors thrown by the root layout
 * itself, where app/error.tsx can't reach. It REPLACES the root layout, so
 * it must render its own <html>/<body> and pull in globals.css for styling.
 * Fonts (wired via next/font on the root layout) won't be present here, so
 * colors are token-based but typography falls back — acceptable for a
 * last-resort screen. Kept dependency-light: whatever crashed the root
 * layout might be one of those dependencies.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled root error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <div className="min-h-dvh flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-[color:var(--hairline-hi)] bg-[color:var(--surface-strong)] p-6 text-center shadow-xl">
            <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/30">
              <AlertTriangle className="size-5 text-red-300" />
            </div>
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-1.5 text-sm opacity-70">
              The app hit an unexpected error and couldn&apos;t load. Try
              reloading the page.
            </p>
            {error.digest && (
              <p className="mt-3 text-xs opacity-50">Ref: {error.digest}</p>
            )}
            <div className="mt-5 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => reset()}
                data-testid="global-error-retry"
                className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 text-sm font-medium ring-1 ring-white/30 hover:bg-white/20 transition-colors"
              >
                Try again
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page reload is intentional after a root-layout crash; next/link relies on router context that may be unusable here */}
              <a
                href="/"
                data-testid="global-error-home"
                className="inline-flex items-center rounded-md px-3 py-1.5 text-sm opacity-70 hover:opacity-100 transition-opacity"
              >
                Go home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
