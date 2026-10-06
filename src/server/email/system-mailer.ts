import "server-only";
import nodemailer from "nodemailer";
import { APP_NAME } from "@/config/app";
import { getServerEnv } from "@/config/env";

/** A system email (sign-in codes are sent by Supabase; this covers invite emails). */
export type SystemEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** The part of a nodemailer transport the mailer needs (tests pass a double). */
export type MailTransport = {
  sendMail: (message: {
    from: { name: string; address: string };
    to: string;
    subject: string;
    html: string;
    text: string;
  }) => Promise<object>;
};

function createSmtpTransport(): MailTransport {
  const env = getServerEnv();
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    requireTLS: env.SMTP_REQUIRE_TLS,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });
}

/** Sends system emails through the platform SMTP account (spec §8: platform Gmail now, Resend later). */
export function createSystemMailer(
  transport: MailTransport = createSmtpTransport(),
) {
  return {
    async send(email: SystemEmail): Promise<void> {
      await transport.sendMail({
        from: { name: APP_NAME, address: getServerEnv().SMTP_FROM },
        ...email,
      });
    },
  };
}
