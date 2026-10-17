import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVER_ENV_NAMES } from "./env";
import { PUBLIC_ENV_NAMES } from "./public-env-schema";

/** Read only by the build (`next.config.ts`, Sentry's source-map upload), never by the app. */
const BUILD_ONLY = ["SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN"];

describe(".env.example", () => {
  it("lists every variable the app reads, and nothing else", () => {
    const listed = readFileSync(join(process.cwd(), ".env.example"), "utf8")
      .split("\n")
      .flatMap((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1] ?? []);
    const read = [
      ...SERVER_ENV_NAMES.filter((name) => name !== "NODE_ENV"),
      ...PUBLIC_ENV_NAMES,
      ...BUILD_ONLY,
    ];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...new Set(read)].sort());
  });
});
