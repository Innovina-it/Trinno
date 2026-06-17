// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateRangePopover, type DateRange } from "@/components/ui/date-range-popover";

afterEach(cleanup);

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

function renderPicker(value: DateRange) {
  const onChange = vi.fn();
  render(createElement(DateRangePopover, { value, onChange }));
  return {
    onChange,
    start: screen.getByTestId("date-range-start") as HTMLInputElement,
    target: screen.getByTestId("date-range-target") as HTMLInputElement,
  };
}

describe("DateRangePopover typed entry", () => {
  it("commits a typed start date", () => {
    const { onChange, start } = renderPicker({ start: null, target: null });
    fireEvent.change(start, { target: { value: "15/06/2026" } });
    expect(onChange).toHaveBeenCalledWith({ start: utc(2026, 6, 15), target: null });
  });

  it("commits a typed target on or after start", () => {
    const { onChange, target } = renderPicker({ start: utc(2026, 6, 10), target: null });
    fireEvent.change(target, { target: { value: "20/06/2026" } });
    expect(onChange).toHaveBeenCalledWith({ start: utc(2026, 6, 10), target: utc(2026, 6, 20) });
  });

  it("auto-advances focus to the target field once a complete start is typed", () => {
    const { start, target } = renderPicker({ start: null, target: null });
    start.focus();
    fireEvent.change(start, { target: { value: "15/06/2026" } });
    expect(document.activeElement).toBe(target);
  });

  it("does NOT steal focus to target when editing a start that already has a target", () => {
    const { start, target } = renderPicker({ start: utc(2026, 6, 1), target: utc(2026, 6, 20) });
    start.focus();
    fireEvent.change(start, { target: { value: "05/06/2026" } });
    expect(document.activeElement).toBe(start);
    expect(target).not.toBe(document.activeElement);
  });

  it("does NOT commit a target before start, and flags it invalid", () => {
    const { onChange, target } = renderPicker({ start: utc(2026, 6, 10), target: null });
    fireEvent.change(target, { target: { value: "05/06/2026" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(target.getAttribute("aria-invalid")).toBe("true");
  });

  it("does NOT commit a start after target, and flags it invalid", () => {
    const { onChange, start } = renderPicker({ start: null, target: utc(2026, 6, 10) });
    fireEvent.change(start, { target: { value: "20/06/2026" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(start.getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps incomplete text uncommitted without flagging mid-typing-complete as invalid", () => {
    const { onChange, start } = renderPicker({ start: null, target: null });
    fireEvent.change(start, { target: { value: "15/06" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears an endpoint to null when its field is emptied", () => {
    const { onChange, target } = renderPicker({ start: utc(2026, 6, 10), target: utc(2026, 6, 20) });
    fireEvent.change(target, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ start: utc(2026, 6, 10), target: null });
  });
});
