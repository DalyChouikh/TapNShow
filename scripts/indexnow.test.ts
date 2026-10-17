import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { INDEXNOW_KEY } from "../src/config/site";
import { submitToIndexNow } from "./indexnow";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

describe("submitToIndexNow", () => {
  it("sends the public pages with the key and where it lives", async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(null, { status: 200 }));
    const result = await submitToIndexNow({
      baseUrl: "https://www.tapnshow.tn",
      fetch,
    });
    expect(result).toEqual({ status: 200, urls: 3 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.indexnow.org/IndexNow");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json; charset=utf-8",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      host: "www.tapnshow.tn",
      key: INDEXNOW_KEY,
      keyLocation: `https://www.tapnshow.tn/${INDEXNOW_KEY}.txt`,
      urlList: [
        "https://www.tapnshow.tn",
        "https://www.tapnshow.tn/privacy",
        "https://www.tapnshow.tn/terms",
      ],
    });
  });

  it("accepts 202 (received, the key still being checked)", async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(null, { status: 202 }));
    await expect(
      submitToIndexNow({ baseUrl: "https://www.tapnshow.tn", fetch }),
    ).resolves.toEqual({ status: 202, urls: 3 });
  });

  it.each([
    [400, "bad request"],
    [403, "key not valid"],
    [422, "URLs don't belong to the host"],
    [429, "too many requests"],
  ])("fails on %s (%s), naming the status", async (status) => {
    const fetch = vi.fn<Fetch>(async () => new Response(null, { status }));
    await expect(
      submitToIndexNow({ baseUrl: "https://www.tapnshow.tn", fetch }),
    ).rejects.toThrow(`IndexNow answered ${status}`);
  });
});

describe("the IndexNow key file", () => {
  it("is served from public/ and holds exactly the key", () => {
    expect(readFileSync(`public/${INDEXNOW_KEY}.txt`, "utf8")).toBe(
      INDEXNOW_KEY,
    );
    expect(INDEXNOW_KEY).toMatch(/^[0-9a-f]{32}$/);
  });
});
