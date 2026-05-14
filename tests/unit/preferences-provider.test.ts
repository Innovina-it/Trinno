// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserPreferencesProvider } from "@/lib/preferences/provider";
import { usePreference } from "@/lib/preferences/use-preference";

const mocks = vi.hoisted(() => ({
  getUserPreferences: vi.fn(),
  setUserPreferences: vi.fn(),
}));

vi.mock("@/actions/profile-preferences", () => ({
  getUserPreferences: mocks.getUserPreferences,
  setUserPreferences: mocks.setUserPreferences,
}));

function SidebarPreferenceProbe() {
  const [sidebarCollapsed, setSidebarCollapsed] =
    usePreference("sidebarCollapsed");

  return React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setSidebarCollapsed(false),
    },
    String(sidebarCollapsed),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getUserPreferences.mockReset();
  mocks.setUserPreferences.mockReset();
  mocks.setUserPreferences.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("UserPreferencesProvider", () => {
  it("debounces preference updates and persists the merged patch", async () => {
    render(
      React.createElement(
        UserPreferencesProvider,
        { initial: { sidebarCollapsed: true } },
        React.createElement(SidebarPreferenceProbe),
      ),
    );

    expect(screen.getByRole("button").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button").textContent).toBe("false");
    expect(mocks.setUserPreferences).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(mocks.setUserPreferences).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(mocks.setUserPreferences).toHaveBeenCalledTimes(1);
    expect(mocks.setUserPreferences).toHaveBeenCalledWith({
      sidebarCollapsed: false,
    });
  });
});
