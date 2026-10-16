import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OTP_EXPIRY_SECONDS } from "@/config/auth";
import { PRIVACY_POLICY_URL } from "@/config/legal";
import { palette } from "@/design/tokens";
import {
  renderSignInCodeTemplate,
  SUPABASE_TOKEN_PLACEHOLDER,
} from "./sign-in-code-email";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("renderSignInCodeTemplate", () => {
  it("keeps Supabase's token placeholder and no sign-in link (the privacy policy is its only link)", async () => {
    const { html } = await renderSignInCodeTemplate();
    expect(html).toContain(SUPABASE_TOKEN_PLACEHOLDER);
    expect(html).not.toContain("ConfirmationURL");
    const hrefs = [...html.matchAll(/<a\s[^>]*href="([^"]*)"/gi)].map(
      (match) => match[1],
    );
    expect(hrefs).toEqual([PRIVACY_POLICY_URL]);
  });

  it("uses the app subject and states the expiry in minutes", async () => {
    const { subject, html } = await renderSignInCodeTemplate();
    expect(subject).toBe("Your TapNShow sign-in code");
    expect(html).toContain(`expires in ${OTP_EXPIRY_SECONDS / 60} minutes`);
  });

  it("follows the Neobrutalist palette without box-shadow or emojis", async () => {
    const { html } = await renderSignInCodeTemplate();
    expect(html).toContain(palette.light.primary);
    expect(html).toContain(palette.light.outline);
    expect(html).not.toContain("box-shadow");
    expect(html).not.toMatch(EMOJI);
  });

  it("is what the local stack sends (regenerate with `bun run auth:config local`)", async () => {
    const { html } = await renderSignInCodeTemplate();
    expect(readFileSync("supabase/templates/sign-in-code.html", "utf8")).toBe(
      html,
    );
  });
});
