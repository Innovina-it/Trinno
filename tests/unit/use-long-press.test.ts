// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLongPress } from "@/lib/hooks/use-long-press";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useLongPress", () => {
  it("fires onClick on a short press", () => {
    const onClick = vi.fn(), onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onClick, onLongPress }));
    act(() => result.current.onPointerDown({ button: 0 } as any));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.onPointerUp());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("fires onLongPress after threshold and suppresses click", () => {
    const onClick = vi.fn(), onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onClick, onLongPress, threshold: 500 }));
    act(() => result.current.onPointerDown({ button: 0 } as any));
    act(() => { vi.advanceTimersByTime(500); });
    act(() => result.current.onPointerUp());
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not long-press when onLongPress is undefined", () => {
    const onClick = vi.fn();
    const { result } = renderHook(() => useLongPress({ onClick }));
    act(() => result.current.onPointerDown({ button: 0 } as any));
    act(() => { vi.advanceTimersByTime(800); });
    act(() => result.current.onPointerUp());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
