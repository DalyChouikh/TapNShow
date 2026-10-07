import "server-only";
import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";

/** One meeting email ready for MIME encoding (spec §9). */
export type MeetingMimeInput = {
  from: { name: string; address: string };
  to: { name: string; address: string };
  subject: string;
  html: string;
  text: string;
  messageId: string;
  inReplyTo: string | null;
  listUnsubscribeUrl: string;
};

/** A new RFC 5322 Message-ID on the app's own host. */
export function newMessageId(appUrl: string): string {
  return `<${randomUUID()}@${new URL(appUrl).host}>`;
}

/**
 * Builds the raw message for Gmail's `users.messages.send` (base64url). nodemailer's composer
 * encodes non-ASCII names and subjects (RFC 2047) and folds lines; line breaks in names are
 * stripped first so a user-written workspace name can never add a header.
 */
export async function buildMeetingMime(
  input: MeetingMimeInput,
): Promise<string> {
  const singleLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
  const composer = new MailComposer({
    from: { name: singleLine(input.from.name), address: input.from.address },
    to: { name: singleLine(input.to.name), address: input.to.address },
    subject: singleLine(input.subject),
    html: input.html,
    text: input.text,
    messageId: input.messageId,
    ...(input.inReplyTo
      ? { inReplyTo: input.inReplyTo, references: input.inReplyTo }
      : {}),
    headers: {
      "List-Unsubscribe": `<${input.listUnsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  const message = await composer.compile().build();
  return message.toString("base64url");
}
