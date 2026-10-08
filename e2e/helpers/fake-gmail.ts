import { createServer, type Server } from "node:http";

/** Port of the fake Google token + Gmail API used by e2e (never a real Google endpoint). */
export const FAKE_GMAIL_PORT = 44399;
/** Base URL the e2e app build uses for `GMAIL_API_BASE_URL`. */
export const FAKE_GMAIL_URL = `http://127.0.0.1:${FAKE_GMAIL_PORT}`;

/** One message the app "sent": `threadId` as requested, `assignedThread` as answered. */
export type FakeGmailMessage = {
  raw: string;
  threadId: string | null;
  assignedThread: string;
};

/**
 * Starts the fake: `POST /token` (refresh grant), `POST /gmail/v1/users/me/messages/send` (stores
 * the message, threads like Gmail), `GET /__messages` (what was sent, for assertions).
 */
export function startFakeGmail(): Promise<Server> {
  const messages: FakeGmailMessage[] = [];
  let threads = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const reply = (status: number, payload: object) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };
      if (request.method === "POST" && request.url === "/token") {
        reply(200, { access_token: "fake", expires_in: 3600 });
        return;
      }
      if (
        request.method === "POST" &&
        request.url === "/gmail/v1/users/me/messages/send"
      ) {
        const sent = JSON.parse(body) as { raw: string; threadId?: string };
        const threadId = sent.threadId ?? `t-${(threads += 1)}`;
        messages.push({
          raw: sent.raw,
          threadId: sent.threadId ?? null,
          assignedThread: threadId,
        });
        reply(200, { id: `m-${messages.length}`, threadId });
        return;
      }
      if (request.method === "GET" && request.url === "/__messages") {
        reply(200, messages);
        return;
      }
      reply(404, { error: { message: "not found" } });
    });
  });
  return new Promise((resolve) =>
    server.listen(FAKE_GMAIL_PORT, "127.0.0.1", () => resolve(server)),
  );
}

/** The messages sent so far. */
export async function sentMessages(): Promise<FakeGmailMessage[]> {
  const response = await fetch(`${FAKE_GMAIL_URL}/__messages`);
  return (await response.json()) as FakeGmailMessage[];
}
