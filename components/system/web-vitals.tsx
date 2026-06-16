"use client";

import { useReportWebVitals } from "next/web-vitals";

// Reports Core Web Vitals (LCP/INP/CLS + FCP/TTFB) for real navigations to
// /api/vitals. Uses sendBeacon so the report survives page unload and never
// blocks render; falls back to keepalive fetch where sendBeacon is absent.
// Renders nothing.
export function WebVitals() {
  useReportWebVitals((metric) => {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      id: metric.id,
      path: window.location.pathname,
    });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/vitals", body);
    } else {
      void fetch("/api/vitals", { method: "POST", body, keepalive: true });
    }
  });
  return null;
}
