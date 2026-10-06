/** Digits in emailed sign-in codes (Supabase `mailer_otp_length`). */
export const OTP_LENGTH = 8;

/** Seconds a sign-in code stays valid (Supabase `mailer_otp_exp`). */
export const OTP_EXPIRY_SECONDS = 900;

/** Seconds before "Resend code" unlocks; Supabase allows one code request per user per 60 s. */
export const OTP_RESEND_SECONDS = 60;

/** Auth emails per hour for the whole project (Supabase `rate_limit_email_sent`, spec §8 budget). */
export const AUTH_EMAILS_PER_HOUR = 15;
