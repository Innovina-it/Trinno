import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const generateLink = vi.fn();
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceSupabase: () => ({ auth: { admin: { generateLink } } }),
  tryGetServiceSupabase: () => null,
}));

import { sendInviteEmail } from "@/lib/invite-email";

describe("sendInviteEmail (#K4)", () => {
  const origFetch = global.fetch;
  beforeEach(() => {
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
});
