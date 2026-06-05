import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const generateLink = vi.fn();
// Mutable knobs the fake service-role client reads. reminderCount drives the
// rolling-hour count query; updateSpy records reminder_sent_at stamps.
let reminderCount = 0;
const updateSpy = vi.fn();
// One thenable query builder serves both the count (.select().gt()) and the
// stamp (.update().eq().eq().eq()) chains — awaiting it resolves the result.
type Builder = {
  select: () => Builder;
  update: (vals: unknown) => Builder;
  gt: () => Builder;
  eq: () => Builder;
  then: (resolve: (v: { count: number; error: null }) => unknown) => unknown;
};
const builder: Builder = {
  select: () => builder,
  update: (vals) => {
    updateSpy(vals);
    return builder;
  },
  gt: () => builder,
  eq: () => builder,
  then: (resolve) => resolve({ count: reminderCount, error: null }),
};
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceSupabase: () => ({
    auth: { admin: { generateLink } },
    from: () => builder,
  }),
  tryGetServiceSupabase: () => null,
}));

import { sendInviteEmail } from "@/lib/invite-email";

describe("sendInviteEmail (#K4)", () => {
  const origFetch = global.fetch;
  beforeEach(() => {
    reminderCount = 0;
    generateLink.mockResolvedValue({
      data: { properties: { action_link: "https://x/verify?token=abc" } },
      error: null,
    });
  });
  afterEach(() => {
    global.fetch = origFetch;
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("soft-fails without sending when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const f = vi.fn();
    global.fetch = f as unknown as typeof fetch;
    await sendInviteEmail("a@b.com", "Acme");
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to Resend and HTML-escapes the workspace name", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const f = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = f as unknown as typeof fetch;
    await sendInviteEmail("a@b.com", "<script>Acme</script>");
    expect(f).toHaveBeenCalledTimes(1);
    const [endpoint, opts] = f.mock.calls[0];
    expect(endpoint).toBe("https://api.resend.com/emails");
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).not.toContain("<script>Acme");
    expect(body.html).toContain("https://x/verify?token=abc");
  });

  it("throws when generateLink returns no action_link", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    generateLink.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(sendInviteEmail("a@b.com", "Acme")).rejects.toThrow();
  });

  it("names the inviter in the subject and headline when provided", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const f = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = f as unknown as typeof fetch;
    await sendInviteEmail("a@b.com", "Acme", "Alice");
    const body = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
    expect(body.subject).toBe("Alice invited you to Acme on Trinno");
    expect(body.html).toContain("Alice invited you to join");
    expect(body.text).toContain("Alice invited you to join Acme");
  });

  it("falls back to impersonal wording without an inviter name", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const f = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = f as unknown as typeof fetch;
    await sendInviteEmail("a@b.com", "Acme");
    const body = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
    expect(body.subject).toBe("You've been invited to Acme on Trinno");
    expect(body.html).toContain("You've been invited to join");
  });

  it("HTML-escapes the inviter name", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const f = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = f as unknown as typeof fetch;
    await sendInviteEmail("a@b.com", "Acme", "<script>Eve</script>");
    const body = JSON.parse((f.mock.calls[0][1] as { body: string }).body);
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).not.toContain("<script>Eve");
  });

  it("blocks with RATE_LIMITED once the hourly cap is reached", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    reminderCount = 4; // default cap is 4
    const f = vi.fn();
    global.fetch = f as unknown as typeof fetch;
    await expect(
      sendInviteEmail("a@b.com", "Acme", undefined, "ws-1"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(f).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("sends and stamps reminder_sent_at when under the cap", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    reminderCount = 3; // under the cap of 4
    const f = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = f as unknown as typeof fetch;
    await sendInviteEmail("a@b.com", "Acme", undefined, "ws-1");
    expect(f).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reminder_sent_at: expect.any(String) }),
    );
  });

  it("honors the INVITE_REMINDER_HOURLY_CAP override", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("INVITE_REMINDER_HOURLY_CAP", "2");
    reminderCount = 2;
    const f = vi.fn();
    global.fetch = f as unknown as typeof fetch;
    await expect(
      sendInviteEmail("a@b.com", "Acme", undefined, "ws-1"),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(f).not.toHaveBeenCalled();
  });
});
