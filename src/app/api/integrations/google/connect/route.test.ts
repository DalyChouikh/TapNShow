import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: { value: true },
  user: {
    value: { id: "me", email: "me@example.test" } as {
      id: string;
      email: string;
    } | null,
  },
  workspace: {
    value: { id: "w1", slug: "club-ab12", myRole: "owner" } as {
      id: string;
      slug: string;
      myRole: string;
    } | null,
  },
}));
vi.mock("@/config/public-env", () => ({
  publicEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    get NEXT_PUBLIC_GMAIL_CONNECT_ENABLED() {
      return mocks.enabled.value;
    },
  },
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "sec",
    LOG_LEVEL: "info",
  }),
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => mocks.user.value,
}));
vi.mock("@/server/queries/workspaces", () => ({
  getWorkspaceBySlug: async () => mocks.workspace.value,
}));

const request = (query: string) =>
  new NextRequest(
    `http://localhost:3000/api/integrations/google/connect?${query}`,
  );

beforeEach(() => {
  mocks.enabled.value = true;
  mocks.user.value = { id: "me", email: "me@example.test" };
  mocks.workspace.value = { id: "w1", slug: "club-ab12", myRole: "owner" };
});

describe("GET /api/integrations/google/connect", () => {
  it("sends the Owner to Google with a short-lived cookie scoped to the connect routes", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      request(
        "workspace=club-ab12&next=%2Fw%2Fclub-ab12%2Fmeetings%2F1%2Fedit%3Fstep%3Dreview",
      ),
    );
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/google/callback",
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/tn_gmail_connect=/);
    expect(cookie).toMatch(/Path=\/api\/integrations\/google/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("returns non-Owners and disabled deployments to settings with a reason", async () => {
    const { GET } = await import("./route");
    mocks.workspace.value = { id: "w1", slug: "club-ab12", myRole: "admin" };
    expect(
      (await GET(request("workspace=club-ab12"))).headers.get("location"),
    ).toBe(
      "http://localhost:3000/w/club-ab12/settings?gmail_error=owner_only#sending",
    );
    mocks.enabled.value = false;
    expect(
      (await GET(request("workspace=club-ab12"))).headers.get("location"),
    ).toBe(
      "http://localhost:3000/w/club-ab12/settings?gmail_error=unavailable#sending",
    );
  });

  it("sends signed-out visitors to sign in first", async () => {
    mocks.user.value = null;
    const { GET } = await import("./route");
    expect(
      (await GET(request("workspace=club-ab12"))).headers.get("location"),
    ).toMatch(/\/login\?next=/);
  });
});
