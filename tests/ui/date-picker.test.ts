// @vitest-environment jsdom
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DatePicker } from "@/components/ui/date-picker";
import { formatDate } from "@/lib/format-date";

afterEach(() => {
  cleanup();
});

function DatePickerHarness({
  initialValue = null,
  minDate,
}: {
  initialValue?: Date | null;
  minDate?: Date | null;
}) {
  const [value, setValue] = useState<Date | null>(initialValue);

  return createElement(
    "div",
    null,
    createElement(DatePicker, {
      value,
      onChange: setValue,
      triggerLabel: "Set due date",
      inputLabel: "Due date",
      minDate,
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

  // minDate floor — dates far in the future keep these assertions independent
  // of the machine clock (any realistic run is well before 2099).
  it("does not commit a typed date earlier than minDate", () => {
    const min = new Date(Date.UTC(2099, 5, 15)); // 15 Jun 2099
    render(createElement(DatePickerHarness, { minDate: min }));

    const input = screen.getByLabelText("Due date") as HTMLInputElement;
    // A day before min: text stays (still editable) but value is not committed.
    fireEvent.change(input, { target: { value: "10/06/2099" } });
    expect(input.value).toBe("10/06/2099");
    expect(screen.getByLabelText("selected date").textContent).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");

    // A day on/after min commits normally.
    fireEvent.change(input, { target: { value: "20/06/2099" } });
    expect(screen.getByLabelText("selected date").textContent).toBe("20/06/2099");
  });

  it("disables grid days before minDate so clicking them is a no-op", () => {
    let captured: Date | null = new Date(Date.UTC(2099, 5, 20));
    function Harness() {
      return createElement(DatePicker, {
        // value seeds the visible month on June 2099 so the disabled
        // (pre-min) days are on screen regardless of today's date.
        value: new Date(Date.UTC(2099, 5, 20)),
        onChange: (d: Date | null) => {
          captured = d;
        },
        triggerLabel: "Pick date",
        inputLabel: "Pick date",
        minDate: new Date(Date.UTC(2099, 5, 15)),
      });
    }
    render(createElement(Harness));

    fireEvent.click(screen.getByLabelText("Pick date"));
    const dialog = screen.getByRole("dialog", { name: "Pick date" });

    const disabledDayButtons = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          (b as HTMLButtonElement).disabled &&
          /^\d+$/.test(b.textContent ?? ""),
      );
    expect(disabledDayButtons.length).toBeGreaterThan(0);

    const before = captured;
    fireEvent.click(disabledDayButtons[0]);
    // No selection change, and the popup stays open (pickDay returned early).
    expect(captured).toBe(before);
    expect(dialog).toBeTruthy();
  });

  it("defaultToToday: an empty field commits today when the calendar opens", () => {
    let captured: Date | null = null;
    function Harness() {
      return createElement(DatePicker, {
        value: null,
        onChange: (d: Date | null) => {
          captured = d;
        },
        triggerLabel: "Set start",
        inputLabel: "Start date",
        defaultToToday: true,
      });
    }
    render(createElement(Harness));

    fireEvent.click(screen.getByLabelText("Start date"));

    const today = new Date();
    expect(captured).not.toBeNull();
    expect((captured as unknown as Date).getUTCFullYear()).toBe(
      today.getUTCFullYear(),
    );
    expect((captured as unknown as Date).getUTCMonth()).toBe(today.getUTCMonth());
    expect((captured as unknown as Date).getUTCDate()).toBe(today.getUTCDate());
  });

  it("defaultToToday clamps the auto-fill up to minDate", () => {
    let captured: Date | null = null;
    const min = new Date(Date.UTC(2099, 5, 15)); // far future → above today
    function Harness() {
      return createElement(DatePicker, {
        value: null,
        onChange: (d: Date | null) => {
          captured = d;
        },
        triggerLabel: "Set target",
        inputLabel: "Target date",
        minDate: min,
        defaultToToday: true,
      });
    }
    render(createElement(Harness));

    fireEvent.click(screen.getByLabelText("Target date"));

    // today < min, so the auto-fill snaps to min, never below it.
    expect((captured as unknown as Date).getTime()).toBe(min.getTime());
  });

  it("blockOpen diverts a trigger interaction to onBlockedOpen and never opens", () => {
    let blocked = 0;
    function Harness() {
      return createElement(DatePicker, {
        value: null,
        onChange: () => {},
        triggerLabel: "Set target",
        inputLabel: "Target date",
        blockOpen: true,
        onBlockedOpen: () => {
          blocked += 1;
        },
      });
    }
    render(createElement(Harness));

    fireEvent.click(screen.getByLabelText("Target date"));

    expect(blocked).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog", { name: "Pick date" })).toBeNull();
  });

  it("controlled open: the open prop shows the calendar", () => {
    function Harness() {
      return createElement(DatePicker, {
        value: null,
        onChange: () => {},
        triggerLabel: "Set start",
        inputLabel: "Start date",
        open: true,
        onOpenChange: () => {},
      });
    }
    render(createElement(Harness));

    expect(screen.getByRole("dialog", { name: "Pick date" })).toBeTruthy();
  });

  it("controlled open + defaultToToday auto-fills when opened programmatically", () => {
    // Mirrors the quick-view redirect: target click pops the start picker
    // open from outside, and an empty start auto-fills today.
    let captured: Date | null = null;
    function Harness() {
      return createElement(DatePicker, {
        value: null,
        onChange: (d: Date | null) => {
          captured = d;
        },
        triggerLabel: "Set start",
        inputLabel: "Start date",
        open: true,
        onOpenChange: () => {},
        defaultToToday: true,
      });
    }
    render(createElement(Harness));

    expect(captured).not.toBeNull();
  });
});
