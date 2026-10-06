import { describe, expect, it } from "vitest";
import { z } from "zod";
import { clientIp, isSameOrigin, parseJsonBody } from "./request";

const url = "https://tapnshow.vercel.app/api/x";

describe("isSameOrigin", () => {
  it("accepts the request's own origin only", () => {
    expect(
      isSameOrigin(
        new Request(url, {
          method: "POST",
          headers: { origin: "https://tapnshow.vercel.app" },
        }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request(url, {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
  });

  it("falls back to Sec-Fetch-Site when Origin is absent", () => {
    expect(
      isSameOrigin(
        new Request(url, {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin" },
        }),
      ),
    ).toBe(true);
    expect(isSameOrigin(new Request(url, { method: "POST" }))).toBe(false);
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns typed data", async () => {
    const result = await parseJsonBody(
      new Request(url, { method: "POST", body: JSON.stringify({ name: "A" }) }),
      schema,
    );
    expect(result).toEqual({ ok: true, data: { name: "A" } });
  });

  it("answers 400 invalid_input for malformed JSON or schema failures", async () => {
    for (const body of ["{", JSON.stringify({ name: "" })]) {
      const result = await parseJsonBody(
        new Request(url, { method: "POST", body }),
        schema,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
      }
    }
  });
});

describe("clientIp", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(
      clientIp(new Request(url, { headers: { "x-real-ip": "203.0.113.9" } })),
    ).toBe("203.0.113.9");
    expect(
      clientIp(
        new Request(url, {
          headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" },
        }),
      ),
    ).toBe("198.51.100.7");
    expect(clientIp(new Request(url))).toBe("unknown");
  });
});
