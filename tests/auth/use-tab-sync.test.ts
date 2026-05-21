// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { createElement } from "react";

type BroadcastMessageHandler = (event: MessageEvent<unknown>) => void;

class TestBroadcastChannel {
  static channels = new Map<string, Set<TestBroadcastChannel>>();
  readonly name: string;
  private readonly listeners = new Set<BroadcastMessageHandler>();

  constructor(name: string) {
    this.name = name;
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

  addEventListener(type: string, h: BroadcastMessageHandler) {
    if (type === "message") this.listeners.add(h);
  }
  removeEventListener(type: string, h: BroadcastMessageHandler) {
    if (type === "message") this.listeners.delete(h);
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
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTabSync hook", () => {
  it("dispatches THEME_UPDATE to onThemeUpdate handler", async () => {
    const tabA = await import("../../lib/auth/broadcast");
    vi.resetModules();
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    const { useTabSync } = await import("../../lib/use-tab-sync");

    const onThemeUpdate = vi.fn();
    const onBoardRefresh = vi.fn();
    function Probe() {
      useTabSync({ onThemeUpdate, onBoardRefresh });
      return null;
    }
    render(createElement(Probe));

    await act(async () => {
      tabA.publishStateSync({ type: "THEME_UPDATE", theme: "dark" });
    });

    expect(onThemeUpdate).toHaveBeenCalledWith({
      type: "THEME_UPDATE",
      theme: "dark",
    });
    expect(onBoardRefresh).not.toHaveBeenCalled();
  });

  it("dispatches BOARD_REFRESH to onBoardRefresh", async () => {
    const tabA = await import("../../lib/auth/broadcast");
    vi.resetModules();
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    const { useTabSync } = await import("../../lib/use-tab-sync");

    const onBoardRefresh = vi.fn();
    const onAny = vi.fn();
    function Probe() {
      useTabSync({ onBoardRefresh, onAny });
      return null;
    }
    render(createElement(Probe));

    await act(async () => {
      tabA.publishStateSync({ type: "BOARD_REFRESH", boardId: "b42" });
    });

    expect(onBoardRefresh).toHaveBeenCalledWith({
      type: "BOARD_REFRESH",
      boardId: "b42",
    });
    expect(onAny).toHaveBeenCalledWith({
      type: "BOARD_REFRESH",
      boardId: "b42",
    });
  });

  it("dispatches LOGOUT to onLogout", async () => {
    const tabA = await import("../../lib/auth/broadcast");
    vi.resetModules();
    vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
    const { useTabSync } = await import("../../lib/use-tab-sync");

    const onLogout = vi.fn();
    function Probe() {
      useTabSync({ onLogout });
      return null;
    }
    render(createElement(Probe));

    await act(async () => {
      tabA.publishStateSync({ type: "LOGOUT", userId: "u1" });
    });

    expect(onLogout).toHaveBeenCalledWith({ type: "LOGOUT", userId: "u1" });
  });
});
