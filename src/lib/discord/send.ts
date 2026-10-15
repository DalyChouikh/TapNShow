import type { DiscordMessage } from "./embed";

/** Longest wait honoured from a 429's `retry_after` before the one retry. */
export const DISCORD_RETRY_CAP_MS = 10_000;

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function retryAfterMs(response: Response): Promise<number> {
  try {
    const body: { retry_after?: number } = await response.json();
    return Math.min(
      Math.ceil((body.retry_after ?? 1) * 1000),
      DISCORD_RETRY_CAP_MS,
    );
  } catch {
    return 1000;
  }
}

/**
 * Posts one message to a Discord webhook with `?wait=true` (Discord answers only once it saved
 * the message, so a refusal is visible), retrying once after a 429's `retry_after`. Never throws
 * for an HTTP status; a network error propagates.
 */
export async function postToDiscord(
  webhookUrl: string,
  message: DiscordMessage,
  deps: {
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ ok: boolean; status: number }> {
  const send = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? wait;
  const post = () =>
    send(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  let response = await post();
  if (response.status === 429) {
    await sleep(await retryAfterMs(response));
    response = await post();
  }
  return { ok: response.ok, status: response.status };
}
