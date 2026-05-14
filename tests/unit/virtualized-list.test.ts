// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualizedList } from "@/components/board/virtualized-list";

const dndState = vi.hoisted(() => ({
  activeId: null as string | null,
}));

vi.mock("@dnd-kit/core", () => ({
  useDndContext: () => {
    const activeId = dndState.activeId;
    return {
      active: activeId
        ? {
            id: activeId,
            data: { current: { cardId: activeId.replace(/^card:/, "") } },
          }
        : null,
    };
  },
}));

type MockCard = {
  id: string;
  title: string;
};

const commandRun = "npm run test:unit -- tests/unit/virtualized-list.test.ts";

function makeCards(count: number): MockCard[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `card-${String(index).padStart(3, "0")}`,
    title: `Card ${index}`,
  }));
}

function CardRow({ card }: { card: MockCard }) {
  return React.createElement(
    "div",
    {
      "data-testid": "card-row",
      "data-card-id": card.id,
      style: { height: 86 },
    },
    card.title,
  );
}

function CardList({
  cards,
  virtualized,
}: {
  cards: MockCard[];
  virtualized: boolean;
}) {
  if (!virtualized) {
    return React.createElement(
      "div",
      { "data-testid": "non-virtualized-list" },
      cards.map((card) =>
        React.createElement(CardRow, {
          key: card.id,
          card,
        }),
      ),
    );
  }

  return React.createElement(
    "div",
    { style: { maxHeight: 960 } },
    React.createElement(VirtualizedList<MockCard>, {
      items: cards,
      estimatedSize: 96,
      overscan: 6,
      render: (card) =>
        React.createElement(CardRow, {
          key: card.id,
          card,
        }),
    }),
  );
}

function scrollVirtualListTo(scrollTop: number) {
  const scroller = screen.getByTestId("virtualized-list");
  act(() => {
    scroller.scrollTop = scrollTop;
    fireEvent.scroll(scroller);
  });
}

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);

beforeEach(() => {
  dndState.activeId = null;
  HTMLElement.prototype.getBoundingClientRect = function () {
    const el = this as HTMLElement;
    const height =
      el.dataset.testid === "virtualized-list"
        ? 960
        : el.dataset.testid === "card-row"
          ? 86
          : 96;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: height,
      width: 320,
      height,
      toJSON: () => undefined,
    };
  };
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return (this as HTMLElement).getBoundingClientRect().height;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return (this as HTMLElement).getBoundingClientRect().width;
    },
  });
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  }
  if (originalOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
  }
});

describe("VirtualizedList board behavior", () => {
  it("GOLDEN: mounts a small virtual window for 500 cards when the flag is on", async () => {
    // Setup: 500 mock cards and the virtualized code path enabled in the harness.
    // Action: render the list, then scroll the virtual scroller down.
    // Expected result: approximately 20 rows mount, and later rows appear after scroll.
    // Actual result: assertions below verify bounded DOM count and Card 250 visibility.
    // Exact command run: npm run test:unit -- tests/unit/virtualized-list.test.ts
    expect(commandRun).toContain("virtualized-list.test.ts");
    render(React.createElement(CardList, { cards: makeCards(500), virtualized: true }));

    await waitFor(() => {
      expect(screen.getAllByTestId("card-row").length).toBeGreaterThan(0);
    });
    const initialRows = screen.getAllByTestId("card-row");
    expect(initialRows.length).toBeGreaterThan(0);
    expect(initialRows.length).toBeLessThanOrEqual(30);
    expect(screen.queryByText("Card 250")).toBeNull();

    scrollVirtualListTo(96 * 250);

    await waitFor(() => {
      expect(screen.getByText("Card 250")).toBeTruthy();
    });
    expect(screen.getAllByTestId("card-row").length).toBeLessThanOrEqual(32);
  });

  it("MIGRATION/BACK-COMPAT: mounts every card when the virtualized path is off", () => {
    // Setup: 500 mock cards and the non-virtualized code path enabled in the harness.
    // Action: render the list without VirtualizedList.
    // Expected result: all 500 rows mount, matching the legacy fully-expanded behavior.
    // Actual result: assertion below verifies every row is present.
    // Exact command run: npm run test:unit -- tests/unit/virtualized-list.test.ts
    expect(commandRun).toContain("virtualized-list.test.ts");
    render(React.createElement(CardList, { cards: makeCards(500), virtualized: false }));

    expect(screen.queryByTestId("virtualized-list")).toBeNull();
    expect(screen.getAllByTestId("card-row")).toHaveLength(500);
  });

  it("FAILURE/EDGE: keeps the dragged row mounted after it scrolls outside the virtual window", async () => {
    // Setup: 500 mock cards, virtualized path on, and dnd-kit active id set to Card 0.
    // Action: scroll far enough that Card 0 would normally leave the virtual window.
    // Expected result: the dragged Card 0 element remains in the DOM.
    // Actual result: assertions below verify Card 0 and the preserved-drag marker remain mounted.
    // Exact command run: npm run test:unit -- tests/unit/virtualized-list.test.ts
    expect(commandRun).toContain("virtualized-list.test.ts");
    dndState.activeId = "card:card-000";
    render(React.createElement(CardList, { cards: makeCards(500), virtualized: true }));

    scrollVirtualListTo(96 * 250);

    await waitFor(() => {
      expect(screen.getByText("Card 250")).toBeTruthy();
    });
    expect(screen.getByText("Card 0")).toBeTruthy();
    expect(
      document.querySelector('[data-preserved-drag="true"] [data-card-id="card-000"]'),
    ).toBeTruthy();
  });
});
