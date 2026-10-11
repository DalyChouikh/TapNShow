import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionAssociatedData,
  openSecret,
} from "@/server/crypto/secret-box";
import { encodeConnectCookie } from "@/server/google/google-oauth";

const KEY = randomBytes(32);
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  revoke: vi.fn(async () => true),
  save: vi.fn(),
  setSender: vi.fn(),
  startSheet: vi.fn(),
  saved: vi.fn(async () => ({ error: null })),
  revokeReleased: vi.fn(async () => undefined),
  schedule: vi.fn(),
}));
vi.mock("@/config/public-env", () => ({
  publicEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_GMAIL_CONNECT_ENABLED: true,
  },
}));
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "sec",
    GOOGLE_TOKEN_ENCRYPTION_KEY: KEY.toString("base64"),
    LOG_LEVEL: "info",
  }),
}));
vi.mock("@/server/google/google-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/google/google-oauth")>()),
  exchangeGoogleCode: mocks.exchange,
  revokeGoogleToken: mocks.revoke,
}));
vi.mock("@/server/supabase/server-client", () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => ({ id: "user-1", email: null }),
}));
vi.mock("@/server/queries/workspaces", () => ({
  getWorkspaceBySlug: async () => ({
    id: "w1",
    slug: "club-ab12",
    myRole: "owner",
  }),
}));
vi.mock("@/server/supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({ admin: true }),
}));
vi.mock("@/server/queries/sender", () => ({
  saveGoogleConnection: mocks.save,
  setWorkspaceSender: mocks.setSender,
}));
vi.mock("@/server/queries/sheets", () => ({
  startSheet: mocks.startSheet,
  googleConnectionSaved: mocks.saved,
}));
vi.mock("@/server/google/release", () => ({
  revokeReleased: mocks.revokeReleased,
}));
vi.mock("@/server/workers/schedule-workers", () => ({
  scheduleWorkers: mocks.schedule,
}));

const stored = {
  state: "s1",
  verifier: "v1",
  workspaceSlug: "club-ab12",
  next: null,
  purpose: "sending" as const,
  replace: false,
};
const callback = (
  query: string,
  cookie:
    Partial<typeof stored> | { purpose: "sheets"; replace?: boolean } = {},
) =>
  new NextRequest(
    `http://localhost:3000/api/integrations/google/callback?${query}`,
    {
      headers: {
        cookie: `tn_gmail_connect=${encodeConnectCookie({ ...stored, ...cookie })}`,
      },
    },
  );
const sheets = { purpose: "sheets" as const };
const grant = (overrides: object = {}) => ({
  refreshToken: "1//rt",
  scopes: ["openid", GMAIL_SEND],
  claims: { sub: "g-1", email: "club@gmail.com", emailVerified: true },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ data: "conn-1", error: null });
  mocks.setSender.mockResolvedValue({ error: null });
  mocks.startSheet.mockResolvedValue({
    data: { started: true, released: null },
    error: null,
  });
});

describe("GET /api/integrations/google/callback", () => {
  it("seals the refresh token, saves the connection, makes it the sender and clears the cookie", async () => {
    mocks.exchange.mockResolvedValueOnce(grant());
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/w/club-ab12/settings?google=connected&google_for=sending#sending",
    );
    expect(mocks.save.mock.calls[0][0]).toEqual({ admin: true });
    const saved = mocks.save.mock.calls[0][1];
    expect(saved).toMatchObject({
      userId: "user-1",
      googleSub: "g-1",
      googleEmail: "club@gmail.com",
    });
    expect(
      openSecret(
        saved.tokenEncrypted,
        KEY,
        connectionAssociatedData("user-1", "g-1"),
      ),
    ).toBe("1//rt");
    expect(mocks.setSender).toHaveBeenCalledWith({}, "w1", "conn-1");
    expect(response.headers.get("set-cookie")).toMatch(/tn_gmail_connect=;/);
  });

  it.each([
    ["error=access_denied&state=s1", "cancelled"],
    ["code=c1&state=wrong", "failed"],
  ])("fails closed for %s", async (query, reason) => {
    const { GET } = await import("./route");
    const response = await GET(callback(query));
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/w/club-ab12/settings?google_error=${reason}&google_for=sending#sending`,
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("refuses consent with neither permission and revokes what Google issued", async () => {
    mocks.exchange.mockResolvedValueOnce(grant({ scopes: ["openid"] }));
    const { GET } = await import("./route");
    expect(
      (await GET(callback("code=c1&state=s1"))).headers.get("location"),
    ).toContain("google_error=scope_denied");
    expect(mocks.revoke).toHaveBeenCalledWith("1//rt");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("explains a missing refresh token", async () => {
    mocks.exchange.mockResolvedValueOnce(grant({ refreshToken: null }));
    const { GET } = await import("./route");
    expect(
      (await GET(callback("code=c1&state=s1"))).headers.get("location"),
    ).toContain("google_error=no_refresh_token");
  });

  it("sheets: saves the connection, starts the sheet, kicks the sheet worker, returns to Sheets", async () => {
    mocks.exchange.mockResolvedValueOnce(
      grant({ scopes: ["openid", DRIVE_FILE] }),
    );
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1", sheets));
    expect(mocks.startSheet).toHaveBeenCalledWith(
      { admin: true },
      {
        userId: "user-1",
        workspaceId: "w1",
        connectionId: "conn-1",
        replace: false,
      },
    );
    expect(mocks.saved).toHaveBeenCalledWith(
      { admin: true },
      { userId: "user-1", connectionId: "conn-1" },
    );
    expect(mocks.schedule).toHaveBeenCalledWith(["sheets"]);
    expect(mocks.setSender).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/w/club-ab12/settings?google=connected&google_for=sheets#sheets",
    );
  });

  it("sheets: an unticked Sheets box saves a Gmail grant but starts nothing", async () => {
    mocks.exchange.mockResolvedValueOnce(
      grant({ scopes: ["openid", GMAIL_SEND] }),
    );
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1", sheets));
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.startSheet).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain(
      "google_error=scope_denied&google_for=sheets",
    );
  });

  it("sheets: neither permission → revoked, nothing saved", async () => {
    mocks.exchange.mockResolvedValueOnce(
      grant({ scopes: ["openid", "email"] }),
    );
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1", sheets));
    expect(mocks.revoke).toHaveBeenCalledWith("1//rt");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain(
      "google_error=scope_denied&google_for=sheets",
    );
  });

  it("sheets: another account than the sheet's → plain message", async () => {
    mocks.exchange.mockResolvedValueOnce(
      grant({ scopes: ["openid", DRIVE_FILE] }),
    );
    mocks.startSheet.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:sheet_wrong_account" },
    });
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1", sheets));
    expect(response.headers.get("location")).toContain(
      "google_error=sheet_wrong_account&google_for=sheets",
    );
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("sheets with replace: revokes the released old account", async () => {
    const released = {
      tokenEncrypted: "v1.a.b.c",
      googleSub: "g-old",
      userId: "00000000-0000-4000-8000-000000000001",
    };
    mocks.exchange.mockResolvedValueOnce(
      grant({ scopes: ["openid", DRIVE_FILE] }),
    );
    mocks.startSheet.mockResolvedValueOnce({
      data: { started: true, released },
      error: null,
    });
    const { GET } = await import("./route");
    await GET(
      callback("code=c1&state=s1", { purpose: "sheets", replace: true }),
    );
    expect(mocks.startSheet.mock.calls[0][1]).toMatchObject({ replace: true });
    expect(mocks.revokeReleased).toHaveBeenCalledWith([released]);
  });

  it("sending: a Sheets-only grant isn't revoked when Gmail is unticked", async () => {
    mocks.exchange.mockResolvedValueOnce(
      grant({ scopes: ["openid", DRIVE_FILE] }),
    );
    const { GET } = await import("./route");
    const response = await GET(callback("code=c1&state=s1"));
    expect(mocks.save).toHaveBeenCalled();
    expect(mocks.setSender).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain(
      "google_error=scope_denied&google_for=sending",
    );
  });

  it("every success re-checks the account's sheets", async () => {
    mocks.exchange.mockResolvedValueOnce(grant());
    const { GET } = await import("./route");
    await GET(callback("code=c1&state=s1"));
    expect(mocks.saved).toHaveBeenCalledWith(
      { admin: true },
      { userId: "user-1", connectionId: "conn-1" },
    );
    expect(mocks.saved.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.save.mock.invocationCallOrder[0],
    );
  });
});
