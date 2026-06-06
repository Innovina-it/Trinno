import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  renderEvent,
  renderDigest,
  escapeHtml,
  TELEGRAM_MAX_MESSAGE_CHARS,
} from "@/lib/notifications/channels/telegram/render";
import { buildSendMessageBody } from "@/lib/notifications/channels/telegram/client";
import type {
  DigestModel,
  NotificationRow,
} from "@/lib/notifications/channels/types";

// PURE renderer + request-body tests for the telegram channel. No network IO,
// no bot token — these assert HTML escaping, the 4096-char digest cap, and the
// constructed "Open card" deep link + sendMessage payload shape.

const BASE = "https://app.trinno.test";

function makeNotification(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n1",
    recipient_user_id: "u1",
    kind: "comment.create",
    related_card_id: "card-123",
    related_board_id: null,
    actor_user_id: "actor-1",
    payload: { actor_name: "Alice", card_title: "Ship it" },
    created_at: "2026-06-05T00:00:00.000Z",
    ...over,
  };
}

type InlineKeyboardMarkup = {
  inline_keyboard: { text: string; url: string }[][];
};

describe("telegram render", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", BASE);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("escapeHtml", () => {
    it("escapes &, <, > in that safe order", () => {
      expect(escapeHtml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
      expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
      // & is escaped first so it does not double-escape produced entities
      expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    });
  });

  describe("renderEvent", () => {
    it("escapes HTML special chars in actor name and card title", () => {
      const n = makeNotification({
        payload: {
          actor_name: "<b>Eve</b> & Co",
          card_title: "fix <tag> & escape",
        },
      });
      const { html } = renderEvent(n);
      // raw injected markup must NOT survive
      expect(html).not.toContain("<b>Eve</b>");
      expect(html).not.toContain("<tag>");
      // escaped forms present
      expect(html).toContain("&lt;b&gt;Eve&lt;/b&gt; &amp; Co");
      expect(html).toContain("fix &lt;tag&gt; &amp; escape");
    });

    it("builds the Open card button URL from base URL + card id", () => {
      const n = makeNotification({ related_card_id: "card-123" });
      const { replyMarkup } = renderEvent(n);
      const markup = replyMarkup as InlineKeyboardMarkup;
      const button = markup.inline_keyboard[0][0];
      expect(button.text).toBe("Open card");
      expect(button.url).toBe(`${BASE}/c/card-123`);
    });

    it("falls back to a board deep link when there is no card", () => {
      const n = makeNotification({
        related_card_id: null,
        related_board_id: "board-9",
        kind: "board.member.added",
      });
      const { replyMarkup } = renderEvent(n);
      const markup = replyMarkup as InlineKeyboardMarkup;
      const button = markup.inline_keyboard[0][0];
      expect(button.url).toBe(`${BASE}/b/board-9`);
    });

    it("omits the button when no base URL is configured", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      const { replyMarkup } = renderEvent(makeNotification());
      expect(replyMarkup).toBeUndefined();
    });

    it("uses a neutral actor fallback when payload has no name", () => {
      const n = makeNotification({ payload: null });
      const { html } = renderEvent(n);
      expect(html).toContain("Someone");
    });
  });

  describe("renderDigest", () => {
    function makeDigest(sectionCount: number, itemsPer: number): DigestModel {
      const sections: DigestModel["sections"] = [];
      let total = 0;
      for (let s = 0; s < sectionCount; s++) {
        const items = [];
        for (let i = 0; i < itemsPer; i++) {
          items.push({
            label: `Card ${s}-${i} with a reasonably long descriptive title`,
            href: `${BASE}/c/card-${s}-${i}`,
          });
          total++;
        }
        sections.push({ heading: `Section ${s} heading`, items });
      }
      return {
        userId: "u1",
        dateStr: "2026-06-05",
        total,
        sections,
        baseUrl: BASE,
        notificationIds: [],
      };
    }

    it("escapes dynamic content in headings and labels", () => {
      const digest: DigestModel = {
        userId: "u1",
        dateStr: "2026-06-05",
        total: 1,
        sections: [
          {
            heading: "<b>news</b> & more",
            items: [{ label: "title <x> & y", href: `${BASE}/c/c1` }],
          },
        ],
        baseUrl: BASE,
        notificationIds: [],
      };
      const { html } = renderDigest(digest);
      expect(html).not.toContain("<b>news</b>");
      expect(html).toContain("&lt;b&gt;news&lt;/b&gt; &amp; more");
      expect(html).toContain("title &lt;x&gt; &amp; y");
    });

    it("stays within 4096 chars and shows a +N more indicator when truncated", () => {
      // Far more items than can fit in one message.
      const digest = makeDigest(40, 40); // 1600 items
      const { html } = renderDigest(digest);
      expect(html.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
      expect(html).toMatch(/\+\d+ more in app/);
    });

    it("does not truncate a small digest and shows no +N more", () => {
      const digest = makeDigest(1, 2);
      const { html } = renderDigest(digest);
      expect(html.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
      expect(html).not.toMatch(/\+\d+ more in app/);
      // both items present
      expect(html).toContain("Card 0-0");
      expect(html).toContain("Card 0-1");
    });

    it("the +N more count reflects the omitted items", () => {
      const digest = makeDigest(40, 40);
      const { html } = renderDigest(digest);
      const m = html.match(/\+(\d+) more in app/);
      expect(m).not.toBeNull();
      const remaining = Number(m![1]);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThan(digest.total);
    });

    it("attaches an Open inbox button pointing at /inbox", () => {
      const digest = makeDigest(1, 1);
      const { replyMarkup } = renderDigest(digest);
      const markup = replyMarkup as InlineKeyboardMarkup;
      expect(markup.inline_keyboard[0][0].url).toBe(`${BASE}/inbox`);
    });
  });

  describe("buildSendMessageBody", () => {
    it("constructs chat_id / text / parse_mode and defaults preview off", () => {
      const body = buildSendMessageBody({
        chatId: "555",
        html: "<b>hi</b>",
      });
      expect(body.chat_id).toBe("555");
      expect(body.text).toBe("<b>hi</b>");
      expect(body.parse_mode).toBe("HTML");
      expect(body.disable_web_page_preview).toBe(true);
      expect("reply_markup" in body).toBe(false);
    });

    it("passes reply_markup through when provided", () => {
      const markup = { inline_keyboard: [[{ text: "Open card", url: `${BASE}/c/c1` }]] };
      const body = buildSendMessageBody({
        chatId: "555",
        html: "x",
        replyMarkup: markup,
      });
      expect(body.reply_markup).toBe(markup);
    });
  });
});
