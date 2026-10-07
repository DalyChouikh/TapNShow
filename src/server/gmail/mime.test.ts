import { describe, expect, it } from "vitest";
import { buildMeetingMime, newMessageId } from "./mime";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");
const headersOf = (raw: string) => decode(raw).split("\r\n\r\n")[0];

const input = {
  from: { name: `Club d'Échecs "A"`, address: "club@gmail.com" },
  to: { name: "Amira Ben Ali", address: "amira@uni.tn" },
  subject: "Weekly sync · Fri 9 Oct, 18:00",
  html: "<p>Hello</p>",
  text: "Hello",
  messageId: "<m-2@tapnshow.vercel.app>",
  inReplyTo: "<m-1@tapnshow.vercel.app>",
  listUnsubscribeUrl: "https://tapnshow.vercel.app/api/r/TOKEN/unsubscribe",
};

describe("buildMeetingMime", () => {
  it("encodes UTF-8 names and subject, threads to the root, and adds one-click unsubscribe", async () => {
    const headers = headersOf(await buildMeetingMime(input));
    expect(headers).toContain(
      "From: =?UTF-8?Q?Club_d=27=C3=89checs_=22A=22?= <club@gmail.com>",
    );
    expect(headers).toContain("To: Amira Ben Ali <amira@uni.tn>");
    expect(headers).toContain(
      "Subject: =?UTF-8?Q?Weekly_sync_=C2=B7_Fri_9_Oct=2C_18=3A00?=",
    );
    expect(headers).toContain("Message-ID: <m-2@tapnshow.vercel.app>");
    expect(headers).toContain("In-Reply-To: <m-1@tapnshow.vercel.app>");
    expect(headers).toContain("References: <m-1@tapnshow.vercel.app>");
    expect(headers).toContain(
      "List-Unsubscribe: <https://tapnshow.vercel.app/api/r/TOKEN/unsubscribe>",
    );
    expect(headers).toContain(
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    );
    expect(headers).toMatch(/Content-Type: multipart\/alternative/);
    expect(headers).not.toMatch(/^Bcc:/m);
  });

  it("leaves the threading headers out of the root email", async () => {
    const headers = headersOf(
      await buildMeetingMime({ ...input, inReplyTo: null }),
    );
    expect(headers).not.toContain("In-Reply-To");
    expect(headers).not.toContain("References");
  });

  it("refuses header injection through names", async () => {
    const headers = headersOf(
      await buildMeetingMime({
        ...input,
        from: {
          name: "Club\r\nBcc: victim@example.test",
          address: "club@gmail.com",
        },
      }),
    );
    expect(headers).not.toMatch(/^Bcc:/m);
  });
});

describe("newMessageId", () => {
  it("uses the app's host", () => {
    expect(newMessageId("https://tapnshow.vercel.app")).toMatch(
      /^<[0-9a-f-]{36}@tapnshow\.vercel\.app>$/,
    );
  });
});
