import { z } from "zod";

const listSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      Created: z.string(),
      To: z.array(z.object({ Address: z.string() })),
    }),
  ),
});
const messageSchema = z.object({ Text: z.string() });

function mailpitUrl(): string {
  const url = process.env.MAILPIT_URL;
  if (!url) {
    throw new Error("MAILPIT_URL missing: run e2e with `bun run test:e2e`");
  }
  return url;
}

/**
 * Polls the local Mailpit inbox for the newest email to `email` and returns its text.
 * @param options.after - ignore emails received before this time (e.g. an earlier code)
 */
export async function latestEmailText(
  email: string,
  options: { after?: Date; timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const after = options.after?.getTime() ?? 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = listSchema.parse(
      await (await fetch(`${mailpitUrl()}/api/v1/messages`)).json(),
    );
    const found = list.messages.find(
      (message) =>
        message.To.some((to) => to.Address === email) &&
        Date.parse(message.Created) >= after,
    );
    if (found) {
      return messageSchema.parse(
        await (
          await fetch(`${mailpitUrl()}/api/v1/message/${found.ID}`)
        ).json(),
      ).Text;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no email for ${email} within ${timeoutMs} ms`);
}

/** The 8-digit sign-in code from the newest sign-in email (optionally one sent after `after`). */
export async function latestSignInCode(
  email: string,
  after?: Date,
): Promise<string> {
  const code = /\b(\d{8})\b/.exec(await latestEmailText(email, { after }))?.[1];
  if (!code) {
    throw new Error(`no sign-in code in the email to ${email}`);
  }
  return code;
}
