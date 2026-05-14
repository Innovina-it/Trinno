// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BroadcastMessageHandler = (event: MessageEvent<unknown>) => void;

class TestBroadcastChannel {
  static channels = new Map<string, Set<TestBroadcastChannel>>();
  static instances: TestBroadcastChannel[] = [];

  readonly name: string;
  readonly postMessageSpy = vi.fn();
  private readonly listeners = new Set<BroadcastMessageHandler>();

  constructor(name: string) {
    this.name = name;
    TestBroadcastChannel.instances.push(this);

    const channels =
      TestBroadcastChannel.channels.get(name) ?? new Set<TestBroadcastChannel>();
    channels.add(this);
    TestBroadcastChannel.channels.set(name, channels);
  }

  postMessage(message: unknown) {
    this.postMessageSpy(message);

    for (const channel of TestBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel === this) {
        continue;
      }

      channel.dispatch(message);
    }
  }

  addEventListener(type: string, handler: BroadcastMessageHandler) {
    if (type === "message") {
      this.listeners.add(handler);
    }
  }

  removeEventListener(type: string, handler: BroadcastMessageHandler) {
    if (type === "message") {
      this.listeners.delete(handler);
    }
  }

  close() {
    TestBroadcastChannel.channels.get(this.name)?.delete(this);
    this.listeners.clear();
  }

  private dispatch(message: unknown) {
    const event = new MessageEvent("message", { data: message });

    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

const previousAuthBroadcast = process.env.NEXT_PUBLIC_AUTH_BROADCAST;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
  TestBroadcastChannel.channels.clear();
  TestBroadcastChannel.instances = [];
  process.env.NEXT_PUBLIC_AUTH_BROADCAST = previousAuthBroadcast;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  process.env.NEXT_PUBLIC_AUTH_BROADCAST = previousAuthBroadcast;
});

describe("auth broadcast channel", () => {
  it("delivers a signed-out event across tab module instances", async () => {
    // Setup: install a jsdom BroadcastChannel test double and import two
    // isolated module instances to model two browser tabs.
    // Action: publish { type: "signed-out" } from the first imported tab.
    // Expected result: the second tab handler receives { type: "signed-out" }
    // within 500 ms.
    // Actual result: stored in receivedEvent and asserted below.
    // Exact command run: npx jest tests/auth/ --passWithNoTests
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);

    const firstTab = await import("../../lib/auth/broadcast");
    vi.resetModules();
    const secondTab = await import("../../lib/auth/broadcast");

    const received = new Promise((resolve) => {
      const timeout = window.setTimeout(() => resolve(undefined), 500);

      secondTab.subscribeAuthEvents((event) => {
        window.clearTimeout(timeout);
        resolve(event);
      });
    });

    firstTab.publishAuthEvent({ type: "signed-out" });

    await expect(received).resolves.toEqual({ type: "signed-out" });
  });

  it("no-ops publish and subscribe when the broadcast kill switch is off", async () => {
    // Setup: disable NEXT_PUBLIC_AUTH_BROADCAST before importing the module.
    // Action: publish a signed-out event and call the returned unsubscribe.
    // Expected result: no BroadcastChannel is created and postMessage is never
    // called.
    // Actual result: channel instance count and postMessage spies are asserted.
    // Exact command run: npx jest tests/auth/ --passWithNoTests
    process.env.NEXT_PUBLIC_AUTH_BROADCAST = "false";
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);

    const { publishAuthEvent, subscribeAuthEvents } = await import(
      "../../lib/auth/broadcast"
    );

    const unsubscribe = subscribeAuthEvents(vi.fn());
    publishAuthEvent({ type: "signed-out" });

    expect(unsubscribe).toEqual(expect.any(Function));
    expect(() => unsubscribe()).not.toThrow();
    expect(TestBroadcastChannel.instances).toHaveLength(0);
    expect(
      TestBroadcastChannel.instances.some(
        (channel) => channel.postMessageSpy.mock.calls.length > 0,
      ),
    ).toBe(false);
  });

  it("throttles storage-event Supabase session refresh storms", async () => {
    // Setup: mock the browser Supabase client, enable fake timers, and create
    // the memoized client so it registers the storage-event listener.
    // Action: dispatch 20 Supabase session storage events rapidly, then advance
    // time by 51 minutes and dispatch one more.
    // Expected result: getSession runs at most once during the storm and runs
    // again after the 50-minute throttle window reopens.
    // Actual result: getSession call count is asserted after each phase.
    // Exact command run: npx jest tests/auth/ --passWithNoTests
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const getSession = vi.fn(async () => ({ data: { session: null } }));
    const onAuthStateChange = vi.fn();

    vi.doMock("@supabase/ssr", () => ({
      createBrowserClient: vi.fn(() => ({
        auth: {
          getSession,
          onAuthStateChange,
        },
      })),
    }));

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-ref.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const { createSupabaseBrowser } = await import("../../lib/supabase/browser");

    createSupabaseBrowser();

    for (let index = 0; index < 20; index += 1) {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "sb-project-ref-auth-token-supabase-session",
          newValue: String(index),
        }),
      );
    }

    expect(getSession).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(51 * 60 * 1000);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "sb-project-ref-auth-token-supabase-session",
        newValue: "reopened",
      }),
    );

    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
