import { describe, expect, it } from "vitest";
import { routePatternUrl, scrubText, scrubUrl } from "./scrub";

describe("scrubUrl", () => {
  it("redacts personal-link tokens but keeps the query", () => {
    expect(scrubUrl("https://www.tapnshow.tn/r/abc123XYZ?choice=late")).toBe(
      "https://www.tapnshow.tn/r/[REDACTED]?choice=late",
    );
  });

  it("redacts relative token paths", () => {
    expect(scrubUrl("/r/abc123/")).toBe("/r/[REDACTED]/");
  });

  it("leaves other URLs untouched", () => {
    expect(scrubUrl("https://www.tapnshow.tn/w/robotics/meetings")).toBe(
      "https://www.tapnshow.tn/w/robotics/meetings",
    );
  });

  it("scrubs OAuth code and state on the Google callback", () => {
    expect(scrubUrl("/api/auth/google/callback?code=4/0Ab&state=xyz")).toBe(
      "/api/auth/google/callback?code=[REDACTED]&state=[REDACTED]",
    );
    expect(scrubUrl("/w/club?state=open")).toBe("/w/club?state=open");
  });

  it("scrubs OAuth code and state on the Gmail connect callback", () => {
    const scrubbed = scrubUrl(
      "/api/integrations/google/callback?code=4/0Ab&state=xyz",
    );
    expect(scrubbed).not.toContain("4/0Ab");
    expect(scrubbed).not.toContain("xyz");
  });

  it("scrubs invite tokens like personal links", () => {
    expect(scrubUrl("https://www.tapnshow.tn/invite/Abc_123-xyz?next=1")).toBe(
      "https://www.tapnshow.tn/invite/[REDACTED]?next=1",
    );
    expect(scrubUrl("/invite/[token]")).toBe("/invite/[token]");
  });

  describe("scrubUrl public token pages (M4)", () => {
    it("redacts unsubscribe, report and token API links", () => {
      expect(scrubUrl("/u/abc")).toBe("/u/[REDACTED]");
      expect(scrubUrl("/report/abc?x=1")).toBe("/report/[REDACTED]?x=1");
      expect(scrubUrl("/api/r/abc/unsubscribe")).toBe(
        "/api/r/[REDACTED]/unsubscribe",
      );
      expect(scrubUrl("https://www.tapnshow.tn/r/abc?choice=late")).toBe(
        "https://www.tapnshow.tn/r/[REDACTED]?choice=late",
      );
      expect(scrubUrl("/w/club/lists")).toBe("/w/club/lists");
    });

    it("redacts admin invite links, encoded slashes too, but not the admin area", () => {
      expect(scrubUrl("https://www.tapnshow.tn/admin/join/abc")).toBe(
        "https://www.tapnshow.tn/admin/join/[REDACTED]",
      );
      expect(scrubUrl("/welcome?next=%2Fadmin%2Fjoin%2Fabc")).toBe(
        "/welcome?next=/admin/join/[REDACTED]",
      );
      expect(scrubUrl("/admin/workspaces")).toBe("/admin/workspaces");
    });
  });
});

describe("routePatternUrl", () => {
  it.each([
    [
      "https://www.tapnshow.tn/r/abcDEF123?choice=going",
      "https://www.tapnshow.tn/r/[token]",
    ],
    ["https://www.tapnshow.tn/u/x1", "https://www.tapnshow.tn/u/[token]"],
    [
      "https://www.tapnshow.tn/report/x1#top",
      "https://www.tapnshow.tn/report/[token]",
    ],
    [
      "https://www.tapnshow.tn/invite/x1",
      "https://www.tapnshow.tn/invite/[token]",
    ],
    [
      "https://www.tapnshow.tn/admin/join/x1",
      "https://www.tapnshow.tn/admin/join/[token]",
    ],
    [
      "https://www.tapnshow.tn/login?next=%2Fr%2Fsecret",
      "https://www.tapnshow.tn/login",
    ],
    [
      "https://www.tapnshow.tn/w/club-ab12/meetings",
      "https://www.tapnshow.tn/w/club-ab12/meetings",
    ],
  ])("%s → %s", (input, expected) => {
    expect(routePatternUrl(input)).toBe(expected);
  });
});

describe("scrubText", () => {
  it("redacts Discord webhook URLs (the token is the path's last part), every host Discord uses", () => {
    for (const host of [
      "discord.com",
      "discordapp.com",
      "canary.discord.com",
      "ptb.discord.com",
    ]) {
      const text = `POST https://${host}/api/webhooks/1560407795768098836/AbC-_x.9yZ?wait=true failed`;
      expect(scrubText(text)).toBe(
        "POST [REDACTED_DISCORD_WEBHOOK]?wait=true failed",
      );
    }
    expect(scrubText("https://discord.com/api/v10/webhooks/123/tok")).toBe(
      "[REDACTED_DISCORD_WEBHOOK]",
    );
  });

  it("keeps redacting the other credential shapes", () => {
    expect(scrubText("key sb_secret_abc123")).toBe(
      "key [REDACTED_SUPABASE_KEY]",
    );
  });
});
