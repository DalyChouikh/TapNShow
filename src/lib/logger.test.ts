import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function memoryStream(): { stream: DestinationStream; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    stream: { write: (message: string) => void lines.push(message) },
  };
}

describe("createLogger", () => {
  it("writes structured JSON with the app name", () => {
    const { stream, lines } = memoryStream();
    createLogger({ level: "info", destination: stream }).info(
      { meetingId: "m1" },
      "sent",
    );
    const entry = JSON.parse(lines[0]) as {
      app: string;
      meetingId: string;
      msg: string;
    };
    expect(entry).toMatchObject({
      app: "TapNShow",
      meetingId: "m1",
      msg: "sent",
    });
  });

  it("redacts secrets, tokens, cookies and authorization headers", () => {
    const { stream, lines } = memoryStream();
    createLogger({ level: "info", destination: stream }).info(
      {
        token: "personal-link-token",
        refreshToken: "1//refresh",
        headers: { authorization: "Bearer abc", cookie: "sb=xyz" },
        job: { token: "nested-token", secret: "s3cr3t" },
      },
      "request",
    );
    const raw = lines[0];
    for (const secret of [
      "personal-link-token",
      "1//refresh",
      "Bearer abc",
      "sb=xyz",
      "nested-token",
      "s3cr3t",
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain("[REDACTED]");
  });

  it("respects the level", () => {
    const { stream, lines } = memoryStream();
    createLogger({ level: "warn", destination: stream }).info("hidden");
    expect(lines).toHaveLength(0);
  });
});
