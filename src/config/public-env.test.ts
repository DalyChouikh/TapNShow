import { describe, expect, it } from "vitest";
import type { EnvSource } from "./env-utils";
import { readPublicEnv } from "./public-env";
import { parsePublicEnv } from "./public-env-schema";

const base = { NEXT_PUBLIC_APP_URL: "https://www.tapnshow.tn" };

describe("readPublicEnv (twin of parsePublicEnv)", () => {
  it.each<[string, EnvSource]>([
    ["only the required URL", base],
    [
      "blank optional values",
      { ...base, NEXT_PUBLIC_SENTRY_DSN: "", NEXT_PUBLIC_VAPID_PUBLIC_KEY: "" },
    ],
    [
      "every value set",
      {
        ...base,
        NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.de.sentry.io/2",
        NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: "abc",
        NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: "true",
        NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: "1",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "B".repeat(87),
        NEXT_PUBLIC_VERCEL_ENV: "preview",
      },
    ],
    [
      "switches off in words",
      {
        ...base,
        NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: "off",
        NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: "FALSE",
      },
    ],
    [
      "switches on in other words",
      {
        ...base,
        NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED: "Yes",
        NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: "enabled",
      },
    ],
    ["production", { ...base, NEXT_PUBLIC_VERCEL_ENV: "production" }],
  ])("reads %s the way the schema does", (_name, source) => {
    expect(readPublicEnv(source)).toEqual(parsePublicEnv(source));
  });
});
