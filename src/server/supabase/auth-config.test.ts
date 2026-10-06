import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTH_EMAILS_PER_HOUR,
  OTP_EXPIRY_SECONDS,
  OTP_LENGTH,
} from "@/config/auth";
import { renderSignInCodeTemplate } from "@/emails/sign-in-code-email";
import { buildAuthConfigPatch } from "./auth-config";

describe("buildAuthConfigPatch", () => {
  const template = {
    subject: "Your TapNShow sign-in code",
    html: "<p>{{ .Token }}</p>",
  };

  it("sets code length, expiry, email rate and site URL from config", () => {
    const patch = buildAuthConfigPatch({
      siteUrl: "https://tapnshow.vercel.app",
      template,
    });
    expect(patch).toMatchObject({
      mailer_otp_length: OTP_LENGTH,
      mailer_otp_exp: OTP_EXPIRY_SECONDS,
      rate_limit_email_sent: AUTH_EMAILS_PER_HOUR,
      site_url: "https://tapnshow.vercel.app",
    });
  });

  it("uses the code template for both magic-link and sign-up confirmation emails", () => {
    const patch = buildAuthConfigPatch({
      siteUrl: "http://localhost:3000",
      template,
    });
    expect(patch.mailer_subjects_magic_link).toBe(template.subject);
    expect(patch.mailer_subjects_confirmation).toBe(template.subject);
    expect(patch.mailer_templates_magic_link_content).toBe(template.html);
    expect(patch.mailer_templates_confirmation_content).toBe(template.html);
  });

  it("local config.toml uses the same subject as the hosted template", async () => {
    const toml = readFileSync("supabase/config.toml", "utf8");
    const { subject } = await renderSignInCodeTemplate();
    expect(subject).toBe("Your TapNShow sign-in code");
    expect(toml.match(/subject = "Your TapNShow sign-in code"/g)).toHaveLength(
      2,
    );
  });
});
