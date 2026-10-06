import {
  AUTH_EMAILS_PER_HOUR,
  OTP_EXPIRY_SECONDS,
  OTP_LENGTH,
} from "@/config/auth";

/** Fields sent to `PATCH /v1/projects/{ref}/config/auth` (Supabase Management API). */
export type AuthConfigPatch = {
  mailer_otp_length: number;
  mailer_otp_exp: number;
  rate_limit_email_sent: number;
  site_url: string;
  mailer_subjects_magic_link: string;
  mailer_templates_magic_link_content: string;
  mailer_subjects_confirmation: string;
  mailer_templates_confirmation_content: string;
};

/**
 * Auth settings shared by every hosted project. The code template goes into both the
 * "Magic Link" and "Confirm signup" templates so a first-time user always gets a code.
 */
export function buildAuthConfigPatch(input: {
  siteUrl: string;
  template: { subject: string; html: string };
}): AuthConfigPatch {
  return {
    mailer_otp_length: OTP_LENGTH,
    mailer_otp_exp: OTP_EXPIRY_SECONDS,
    rate_limit_email_sent: AUTH_EMAILS_PER_HOUR,
    site_url: input.siteUrl,
    mailer_subjects_magic_link: input.template.subject,
    mailer_templates_magic_link_content: input.template.html,
    mailer_subjects_confirmation: input.template.subject,
    mailer_templates_confirmation_content: input.template.html,
  };
}
