// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BroadcastMessageHandler = (event: MessageEvent<unknown>) => void;

class TestBroadcastChannel {
  static channels = new Map<string, Set<TestBroadcastChannel>>();
  static instances: TestBroadcastChannel[] = [];

  readonly name: string;
  private readonly listeners = new Set<BroadcastMessageHandler>();

  constructor(name: string) {
    this.name = name;
    TestBroadcastChannel.instances.push(this);
    const set =
      TestBroadcastChannel.channels.get(name) ?? new Set<TestBroadcastChannel>();
    set.add(this);
    TestBroadcastChannel.channels.set(name, set);
  }

  postMessage(message: unknown) {
    for (const ch of TestBroadcastChannel.channels.get(this.name) ?? []) {
      if (ch !== this) ch.dispatch(message);
    }
  }

  addEventListener(type: string, handler: BroadcastMessageHandler) {
    if (type === "message") this.listeners.add(handler);
  }

  removeEventListener(type: string, handler: BroadcastMessageHandler) {
    if (type === "message") this.listeners.delete(handler);
  }

  close() {
    TestBroadcastChannel.channels.get(this.name)?.delete(this);
    this.listeners.clear();
  }

  private dispatch(message: unknown) {
    const event = new MessageEvent("message", { data: message });
    for (const l of this.listeners) l(event);
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  TestBroadcastChannel.channels.clear();
  TestBroadcastChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadFreshTab() {
  vi.resetModules();
  return await import("../../lib/auth/broadcast");
}

describe("state-sync broadcast events", () => {
  it("opens the channel named trinno_state_sync", async () => {
    const tab = await loadFreshTab();
    tab.publishStateSync({ type: "signed-in" });
    expect(
      TestBroadcastChannel.instances.some((c) => c.name === "trinno_state_sync"),
    ).toBe(true);
  });

  it("delivers THEME_UPDATE to a second tab", async () => {
    const tabA = await loadFreshTab();
    const tabB = await loadFreshTab();

    const received: unknown[] = [];
    tabB.subscribeStateSync((e) => received.push(e));

    tabA.publishStateSync({ type: "THEME_UPDATE", theme: "dark" });
    expect(received).toEqual([{ type: "THEME_UPDATE", theme: "dark" }]);
  });

  it("delivers BOARD_REFRESH to a second tab", async () => {
    const tabA = await loadFreshTab();
    const tabB = await loadFreshTab();

    const received: unknown[] = [];
    tabB.subscribeStateSync((e) => received.push(e));

    tabA.publishStateSync({ type: "BOARD_REFRESH", boardId: "b1" });
    expect(received).toEqual([{ type: "BOARD_REFRESH", boardId: "b1" }]);
  });

  it("delivers LOGOUT to a second tab", async () => {
    const tabA = await loadFreshTab();
    const tabB = await loadFreshTab();

    const received: unknown[] = [];
    tabB.subscribeStateSync((e) => received.push(e));

    tabA.publishStateSync({ type: "LOGOUT" });
    expect(received).toEqual([{ type: "LOGOUT" }]);
  });

  it("does not deliver to the sending tab (self-filter)", async () => {
    const tabA = await loadFreshTab();
    const received: unknown[] = [];
    tabA.subscribeStateSync((e) => received.push(e));
    tabA.publishStateSync({ type: "THEME_UPDATE", theme: "light" });
    expect(received).toEqual([]);
  });

  it("ignores unknown event types (forward compat)", async () => {
    const tabA = await loadFreshTab();
    const tabB = await loadFreshTab();

    const received: unknown[] = [];
    tabB.subscribeStateSync((e) => received.push(e));

    // Send a malformed event by reaching into the raw channel
    const channelA = TestBroadcastChannel.instances.find(
      (c) => c.name === "trinno_state_sync",
    )!;
    channelA.postMessage({ type: "UNKNOWN_FUTURE_EVENT", tabId: "x" });
    expect(received).toEqual([]);
    void tabA;
  });

  it("publishAuthEvent/subscribeAuthEvents still work (backward compat)", async () => {
    const tabA = await loadFreshTab();
    const tabB = await loadFreshTab();

    const received: unknown[] = [];
    tabB.subscribeAuthEvents((e) => received.push(e));

    tabA.publishAuthEvent({ type: "signed-out", userId: "u1" });
    expect(received).toEqual([{ type: "signed-out", userId: "u1" }]);
  });

  it("subscribeAuthEvents filters out non-auth events", async () => {
    const tabA = await loadFreshTab();
    const tabB = await loadFreshTab();

    const received: unknown[] = [];
    tabB.subscribeAuthEvents((e) => received.push(e));

    tabA.publishStateSync({ type: "THEME_UPDATE", theme: "dark" });
    tabA.publishStateSync({ type: "BOARD_REFRESH", boardId: "b1" });
    tabA.publishStateSync({ type: "signed-in" });

    expect(received).toEqual([{ type: "signed-in" }]);
  });

  it("kill switch (NEXT_PUBLIC_AUTH_BROADCAST=false) no-ops publish/subscribe", async () => {
    const previous = process.env.NEXT_PUBLIC_AUTH_BROADCAST;
    process.env.NEXT_PUBLIC_AUTH_BROADCAST = "false";
    try {
      const tab = await loadFreshTab();
      const unsubscribe = tab.subscribeStateSync(() => {});
      tab.publishStateSync({ type: "THEME_UPDATE", theme: "dark" });
      expect(unsubscribe).toBeTypeOf("function");
      expect(TestBroadcastChannel.instances).toHaveLength(0);
    } finally {
      process.env.NEXT_PUBLIC_AUTH_BROADCAST = previous;
    }
  });
});
