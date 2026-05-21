"use client";

import { useEffect } from "react";
import {
  subscribeStateSync,
  type AuthEvent,
  type BoardEvent,
  type LogoutEvent,
  type StateSyncEvent,
  type ThemeEvent,
} from "@/lib/auth/broadcast";

export type TabSyncHandlers = {
  onLogout?: (event: LogoutEvent) => void;
  onThemeUpdate?: (event: ThemeEvent) => void;
  onBoardRefresh?: (event: BoardEvent) => void;
  onSignedIn?: (event: Extract<AuthEvent, { type: "signed-in" }>) => void;
  onSignedOut?: (event: Extract<AuthEvent, { type: "signed-out" }>) => void;
  onTokenRefreshed?: (
    event: Extract<AuthEvent, { type: "token-refreshed" }>,
  ) => void;
  onSessionExpired?: (
    event: Extract<AuthEvent, { type: "session-expired" }>,
  ) => void;
  onAny?: (event: StateSyncEvent) => void;
};

export function useTabSync(handlers: TabSyncHandlers): void {
  useEffect(() => {
    return subscribeStateSync((event) => {
      handlers.onAny?.(event);
      switch (event.type) {
        case "LOGOUT":
          handlers.onLogout?.(event);
          break;
        case "THEME_UPDATE":
          handlers.onThemeUpdate?.(event);
          break;
        case "BOARD_REFRESH":
          handlers.onBoardRefresh?.(event);
          break;
        case "signed-in":
          handlers.onSignedIn?.(event);
          break;
        case "signed-out":
          handlers.onSignedOut?.(event);
          break;
        case "token-refreshed":
          handlers.onTokenRefreshed?.(event);
          break;
        case "session-expired":
          handlers.onSessionExpired?.(event);
          break;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
