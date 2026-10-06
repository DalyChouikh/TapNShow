import { describe, expect, it } from "vitest";
import { OTP_EXPIRY_SECONDS } from "@/config/auth";
import { palette } from "@/design/tokens";
import {
  renderSignInCodeTemplate,
  SUPABASE_TOKEN_PLACEHOLDER,
} from "./sign-in-code-email";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("renderSignInCodeTemplate", () => {
  it("keeps Supabase's token placeholder and no link", async () => {
    const { html } = await renderSignInCodeTemplate();
    expect(html).toContain(SUPABASE_TOKEN_PLACEHOLDER);
    expect(html).not.toContain("ConfirmationURL");
    expect(html).not.toMatch(/<a\s/i);
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
});
