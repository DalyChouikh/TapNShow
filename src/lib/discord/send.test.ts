import { describe, expect, it, vi } from "vitest";
import { discordMessage } from "./embed";
import { postToDiscord } from "./send";

const message = discordMessage({
  tone: "info",
  title: "t",
  source: "s",
  at: new Date(0),
});
const url = "https://discord.com/api/webhooks/1/abc";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
type Sleep = (ms: number) => Promise<void>;

describe("postToDiscord", () => {
  it("posts JSON with ?wait=true so a refused message is noticed", async () => {
    const fetch = vi.fn<
      (input: string, init: RequestInit) => Promise<Response>
    >(async () => new Response("{}", { status: 200 }));
    await expect(postToDiscord(url, message, { fetch })).resolves.toEqual({
      ok: true,
      status: 200,
    });
    const [target, init] = fetch.mock.calls[0];
    expect(target).toBe(`${url}?wait=true`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(message);
  });

  it("waits Discord's retry_after once on 429, then tries again", async () => {
    const sleep = vi.fn<Sleep>(async () => {});
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(
      postToDiscord(url, message, { fetch, sleep }),
    ).resolves.toEqual({ ok: true, status: 200 });
    expect(sleep).toHaveBeenCalledWith(1500);
  });

  it("gives up after the one retry and on any other error status", async () => {
    const fetch = vi.fn<Fetch>(async () => new Response("{}", { status: 400 }));
    await expect(postToDiscord(url, message, { fetch })).resolves.toEqual({
      ok: false,
      status: 400,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("caps a long retry_after at 10 s", async () => {
    const sleep = vi.fn<Sleep>(async () => {});
    const fetch = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retry_after: 900 }), { status: 429 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await expect(
      postToDiscord(url, message, { fetch, sleep }),
    ).resolves.toEqual({ ok: false, status: 429 });
    expect(sleep).toHaveBeenCalledWith(10_000);
  });
});
