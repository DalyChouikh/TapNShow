import { describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "@/config/env";
import type { PublicEnv } from "@/config/public-env";

vi.mock("@/server/supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({}),
}));

const { pushConfigured } = await import("./push-deps");

const server = (over: Partial<ServerEnv>) => over as ServerEnv;
const pub = (key?: string) =>
  ({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: key }) as PublicEnv;

describe("pushConfigured", () => {
  it("needs the private key, the subject and the public key together", () => {
    const full = {
      VAPID_PRIVATE_KEY: "k".repeat(43),
      VAPID_SUBJECT: "mailto:a@example.test",
    };
    expect(pushConfigured(server(full), pub("B".repeat(87)))).toBe(true);
    expect(pushConfigured(server(full), pub())).toBe(false);
    expect(
      pushConfigured(
        server({ VAPID_SUBJECT: full.VAPID_SUBJECT }),
        pub("B".repeat(87)),
      ),
    ).toBe(false);
  });
});
