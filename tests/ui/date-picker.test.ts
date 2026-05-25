// @vitest-environment jsdom
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DatePicker } from "@/components/ui/date-picker";
import { formatDate } from "@/lib/format-date";

afterEach(() => {
  cleanup();
});

function DatePickerHarness({ initialValue = null }: { initialValue?: Date | null }) {
  const [value, setValue] = useState<Date | null>(initialValue);

  return createElement(
    "div",
    null,
    createElement(DatePicker, {
      value,
      onChange: setValue,
      triggerLabel: "Set due date",
      inputLabel: "Due date",
    }),
    createElement("output", { "aria-label": "selected date" }, formatDate(value)),
  );
}

describe("DatePicker", () => {
  it("opens the picker when the date display area is clicked", () => {
    render(createElement(DatePickerHarness));

    fireEvent.click(screen.getByLabelText("Due date"));

    expect(screen.getByRole("dialog", { name: "Pick date" })).toBeTruthy();
  });

  it("updates the value when a date string is typed into the input", () => {
    render(createElement(DatePickerHarness));

    const input = screen.getByLabelText("Due date") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "14/05/2026" } });

    expect(input.value).toBe("14/05/2026");
    expect(screen.getByLabelText("selected date").textContent).toBe("14/05/2026");
  });

  it("opens the picker when Enter is pressed on the display area", () => {
    render(createElement(DatePickerHarness));

    fireEvent.keyDown(screen.getByLabelText("Due date"), { key: "Enter" });

    expect(screen.getByRole("dialog", { name: "Pick date" })).toBeTruthy();
  });

  it("picking a day from the grid fires onChange and closes the popup", () => {
    let captured: Date | null = null;
    function Harness() {
      return createElement(DatePicker, {
        value: null,
        onChange: (d: Date | null) => {
          captured = d;
        },
        triggerLabel: "Jump to date",
        inputLabel: "Jump to date",
      });
    }
    render(createElement(Harness));

    fireEvent.click(screen.getByLabelText("Jump to date"));
    expect(screen.getByRole("dialog", { name: "Pick date" })).toBeTruthy();

    const dayButton = screen.getAllByRole("button").find((b) => b.textContent === "15");
    if (!dayButton) throw new Error("day-15 button not found");
    fireEvent.click(dayButton);

    expect(captured).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "Pick date" })).toBeNull();
  });
});
