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

  it("redacts snake_case, nested, capitalised and app-password secrets", () => {
    const { stream, lines } = memoryStream();
    createLogger({ level: "info", destination: stream }).info(
      {
        refresh_token: "leak-refresh",
        access_token: "leak-access",
        accessToken: "leak-access-2",
        headers: {
          Authorization: "Bearer leak-auth",
          "set-cookie": "leak-cookie",
        },
        req: { raw: { headers: { cookie: "leak-raw-cookie" } } },
        job: { payload: { token: "leak-nested" } },
        smtp: {
          auth: { user: "platform@gmail.com", pass: "leak-app-password" },
        },
        push: { keys: { auth: "leak-push-auth" } },
      },
      "secrets",
    );
    for (const secret of [
      "leak-refresh",
      "leak-access",
      "leak-access-2",
      "leak-auth",
      "leak-cookie",
      "leak-raw-cookie",
      "leak-nested",
      "leak-app-password",
      "leak-push-auth",
    ]) {
      expect(lines[0]).not.toContain(secret);
    }
  });

  it("scrubs personal-link tokens from fields, messages and errors", () => {
    const { stream, lines } = memoryStream();
    const logger = createLogger({ level: "info", destination: stream });
    logger.info({ url: "https://x.app/r/tok_field?choice=attend" }, "field");
    logger.info("visited /r/tok_message");
    logger.error({ err: new Error("failed for /r/tok_error") }, "boom");
    const all = lines.join("\n");
    for (const token of ["tok_field", "tok_message", "tok_error"]) {
      expect(all).not.toContain(token);
    }
    expect(all).toContain("/r/[REDACTED]");
  });

  it("keeps error details while scrubbing them", () => {
    const { stream, lines } = memoryStream();
    createLogger({ level: "info", destination: stream }).error(
      { err: new Error("failed for /r/tok_error") },
      "boom",
    );
    const entry = JSON.parse(lines[0]) as {
      err: { type: string; message: string; stack: string };
    };
    expect(entry.err.type).toBe("Error");
    expect(entry.err.message).toBe("failed for /r/[REDACTED]");
    expect(entry.err.stack).toContain("failed for /r/[REDACTED]");
    expect(entry.err.stack).not.toContain("tok_error");
  });

  it("scrubs child-logger bindings and format arguments", () => {
    const { stream, lines } = memoryStream();
    const logger = createLogger({ level: "info", destination: stream });
    logger
      .child({ refreshToken: "leak-binding", url: "/r/tok_binding" })
      .info("child");
    logger.info("payload %o", { token: "leak-format", url: "/r/tok_format" });
    const all = lines.join("\n");
    for (const secret of [
      "leak-binding",
      "tok_binding",
      "leak-format",
      "tok_format",
    ]) {
      expect(all).not.toContain(secret);
    }
  });

  it("scrubs credential-shaped strings in messages", () => {
    const { stream, lines } = memoryStream();
    const logger = createLogger({ level: "info", destination: stream });
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl";
    logger.info(`header Bearer abc.def-123 and jwt ${jwt}`);
    logger.info("google ya29.a0AfH6SMBxyz and 1//0gLongRefreshTokenValue-xyz");
    logger.info("supabase sb_secret_AbC123xyz key");
    const all = lines.join("\n");
    for (const secret of [
      "abc.def-123",
      jwt,
      "ya29.a0AfH6SMBxyz",
      "1//0gLongRefreshTokenValue-xyz",
      "sb_secret_AbC123xyz",
    ]) {
      expect(all).not.toContain(secret);
    }
  });
});
