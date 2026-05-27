import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import { AuthBroadcastListener } from "./(auth)/auth-broadcast-listener";
import { EnvBadge } from "@/components/ui/env-badge";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jb-mono",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trinno",
  description: "Internal workspace for boards, roadmap, and dashboards.",
  // Non-production (preview / pre-prod) deploys must not be indexed.
  ...(process.env.VERCEL_ENV !== "production"
    ? { robots: { index: false, follow: false } }
    : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const DENSITY_VALUES = new Set(["compact", "comfortable", "spacious"]);

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // SSR body data-attrs from cookie mirror to avoid first-paint flicker.
  // Provider keeps these cookies in sync on the client; the debounced
  // Server Action remains the source of truth for persistence.
  const cookieStore = await cookies();
  const sidebarCollapsed = cookieStore.get("pref_sb")?.value === "1";
  const densityCookie = cookieStore.get("pref_density")?.value;
  const density =
    densityCookie && DENSITY_VALUES.has(densityCookie)
      ? densityCookie
      : "comfortable";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable}`}
    >
      <body
        className="min-h-dvh bg-background text-foreground antialiased font-sans"
        data-density={density}
        {...(sidebarCollapsed ? { "data-sidebar-collapsed": "true" } : {})}
      >
        <AuthBroadcastListener />
        {children}
        <EnvBadge />
        <Toaster richColors />
      </body>
    </html>
  );
}
