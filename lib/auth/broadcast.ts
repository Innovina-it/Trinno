export type AuthEvent =
  | { type: "signed-in"; userId?: string }
  | { type: "signed-out"; userId?: string }
  | { type: "token-refreshed"; userId?: string }
  | { type: "session-expired"; userId?: string };

const AUTH_BROADCAST_CHANNEL = "trinno-auth-v1";

type AuthBroadcastMessage = AuthEvent & {
  tabId: string;
};

let authChannel: BroadcastChannel | undefined;

const tabId =
  globalThis.crypto?.randomUUID?.() ??
  `tab-${Math.random().toString(36).slice(2)}`;

function isAuthBroadcastEnabled() {
  return process.env.NEXT_PUBLIC_AUTH_BROADCAST !== "false";
}

function getAuthBroadcastChannel() {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined" ||
    !isAuthBroadcastEnabled()
  ) {
    return undefined;
  }

  if (!authChannel) {
    authChannel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
  }

  return authChannel;
}

function isAuthBroadcastMessage(data: unknown): data is AuthBroadcastMessage {
  if (!data || typeof data !== "object") {
    return false;
  }

  const candidate = data as { type?: unknown; tabId?: unknown };

  return (
    typeof candidate.tabId === "string" &&
    (candidate.type === "signed-in" ||
      candidate.type === "signed-out" ||
      candidate.type === "token-refreshed" ||
      candidate.type === "session-expired")
  );
}

export function publishAuthEvent(event: AuthEvent): void {
  const channel = getAuthBroadcastChannel();

  if (!channel) {
    return;
  }

  channel.postMessage({ ...event, tabId });
}

export function subscribeAuthEvents(
  handler: (event: AuthEvent) => void,
): () => void {
  const channel = getAuthBroadcastChannel();

  if (!channel) {
    return () => undefined;
  }

  const onMessage = (message: MessageEvent<unknown>) => {
    if (!isAuthBroadcastMessage(message.data) || message.data.tabId === tabId) {
      return;
    }

    const event =
      message.data.userId === undefined
        ? { type: message.data.type }
        : { type: message.data.type, userId: message.data.userId };

    handler(event);
  };

  channel.addEventListener("message", onMessage);

  return () => {
    channel.removeEventListener("message", onMessage);
  };
}
