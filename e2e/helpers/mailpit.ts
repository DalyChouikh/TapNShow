import { z } from "zod";

const listSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
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

/** Polls the local Mailpit inbox for the newest email to `email` and returns its text. */
export async function latestEmailText(
  email: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = listSchema.parse(
      await (await fetch(`${mailpitUrl()}/api/v1/messages`)).json(),
    );
    const found = list.messages.find((message) =>
      message.To.some((to) => to.Address === email),
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

/** The 8-digit sign-in code from the newest sign-in email. */
export async function latestSignInCode(email: string): Promise<string> {
  const code = /\b(\d{8})\b/.exec(await latestEmailText(email))?.[1];
  if (!code) {
    throw new Error(`no sign-in code in the email to ${email}`);
  }
  return code;
}
