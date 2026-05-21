export type AuthEvent =
  | { type: "signed-in"; userId?: string }
  | { type: "signed-out"; userId?: string }
  | { type: "token-refreshed"; userId?: string }
  | { type: "session-expired"; userId?: string };

export type ThemeEvent = {
  type: "THEME_UPDATE";
  theme: "light" | "dark" | "system";
};

export type BoardEvent = {
  type: "BOARD_REFRESH";
  boardId: string;
};

export type LogoutEvent = { type: "LOGOUT"; userId?: string };

export type StateSyncEvent =
  | AuthEvent
  | ThemeEvent
  | BoardEvent
  | LogoutEvent;

const STATE_SYNC_CHANNEL = "trinno_state_sync";

type StateSyncMessage = StateSyncEvent & { tabId: string };

const broadcastTabId =
  globalThis.crypto?.randomUUID?.() ??
  `tab-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | undefined;

function isStateSyncEnabled() {
  return process.env.NEXT_PUBLIC_AUTH_BROADCAST !== "false";
}

function getChannel() {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined" ||
    !isStateSyncEnabled()
  ) {
    return undefined;
  }

  if (!channel) {
    channel = new BroadcastChannel(STATE_SYNC_CHANNEL);
  }

  return channel;
}

function isKnownEventType(type: unknown): type is StateSyncEvent["type"] {
  return (
    type === "signed-in" ||
    type === "signed-out" ||
    type === "token-refreshed" ||
    type === "session-expired" ||
    type === "THEME_UPDATE" ||
    type === "BOARD_REFRESH" ||
    type === "LOGOUT"
  );
}

function isStateSyncMessage(data: unknown): data is StateSyncMessage {
  if (!data || typeof data !== "object") return false;
  const candidate = data as { type?: unknown; tabId?: unknown };
  return typeof candidate.tabId === "string" && isKnownEventType(candidate.type);
}

export function publishStateSync(event: StateSyncEvent): void {
  const ch = getChannel();
  if (!ch) return;
  ch.postMessage({ ...event, tabId: broadcastTabId });
}

export function subscribeStateSync(
  handler: (event: StateSyncEvent) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => undefined;

  const onMessage = (message: MessageEvent<unknown>) => {
    if (!isStateSyncMessage(message.data)) return;
    if (message.data.tabId === broadcastTabId) return;
    const event = { ...message.data } as StateSyncMessage;
    delete (event as Partial<StateSyncMessage>).tabId;
    handler(event as unknown as StateSyncEvent);
  };

  ch.addEventListener("message", onMessage);
  return () => ch.removeEventListener("message", onMessage);
}

export function publishAuthEvent(event: AuthEvent): void {
  publishStateSync(event);
}

export function subscribeAuthEvents(
  handler: (event: AuthEvent) => void,
): () => void {
  return subscribeStateSync((event) => {
    if (
      event.type === "signed-in" ||
      event.type === "signed-out" ||
      event.type === "token-refreshed" ||
      event.type === "session-expired"
    ) {
      handler(event);
    }
  });
}
