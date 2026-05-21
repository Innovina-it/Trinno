"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTabSync } from "@/lib/use-tab-sync";
import { installTabIdInterceptor } from "@/lib/http/fetch-with-tab-id";

function applyTheme(theme: "light" | "dark" | "system") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  root.classList.toggle("dark", resolved === "dark");
  try {
    window.localStorage?.setItem("theme", theme);
  } catch {
    /* swallow */
  }
}

export function AuthBroadcastListener() {
  const router = useRouter();

  useEffect(() => {
    installTabIdInterceptor();
  }, []);

  useTabSync({
    onSignedOut: () => {
      router.push("/login");
    },
    onLogout: () => {
      router.push("/login");
    },
    onSignedIn: () => {
      router.refresh();
    },
    onTokenRefreshed: () => {
      router.refresh();
    },
    onSessionExpired: () => {
      toast.error("Session expired", {
        description: "Sign in again to continue.",
      });
      window.location.href = "/login";
    },
    onThemeUpdate: ({ theme }) => {
      applyTheme(theme);
    },
  });

  return null;
}
