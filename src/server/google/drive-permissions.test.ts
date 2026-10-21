import { describe, expect, it, vi } from "vitest";
import {
  classifyShareResponse,
  createDrivePermissionsClient,
} from "./drive-permissions";
import type { FetchLike } from "./google-call";

const DRIVE = "https://drive.example.test";
const error = (code: number, reason: string, message = "x") =>
  JSON.stringify({ error: { code, message, errors: [{ reason }] } });
const json = (status: number, body: object | string) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });

function client(responses: Response[]) {
  const fetchImpl = vi.fn<FetchLike>();
  for (const response of responses) {
    fetchImpl.mockResolvedValueOnce(response);
  }
  return {
    fetchImpl,
    drive: createDrivePermissionsClient({
      driveBaseUrl: DRIVE,
      timeoutMs: 1_000,
      pageSize: 2,
      fetchImpl,
    }),
  };
}

describe("classifyShareResponse", () => {
  const refused = { kind: "refused", unexpected: null };
  it.each([
    [400, error(400, "invalidSharingRequest"), refused],
    [400, error(400, "invalid"), refused],
    [400, error(400, "badRequest"), refused],
    [403, error(403, "forbidden"), refused],
    [
      403,
      error(403, "sharingRateLimitExceeded"),
      { kind: "retry", status: 403 },
    ],
    [403, error(403, "rateLimitExceeded"), { kind: "retry", status: 403 }],
    [429, error(429, "rateLimitExceeded"), { kind: "retry", status: 429 }],
    [404, error(404, "notFound"), { kind: "not_found" }],
    [401, error(401, "authError"), { kind: "unauthorized" }],
    [
      403,
      error(403, "accessNotConfigured"),
      { kind: "bug", status: 403, reason: "accessNotConfigured" },
    ],
    [503, "", { kind: "retry", status: 503 }],
  ])("maps %i %s", (status, body, expected) => {
    expect(classifyShareResponse(status, body)).toEqual(expected);
  });

  // The run listed this file's permissions with the same token just before: an unknown 400, 403 or
  // other client error is about this address, never a reason to stop the whole sheet.
  it.each([
    [
      403,
      error(403, "insufficientFilePermissions"),
      "insufficientFilePermissions",
    ],
    [400, error(400, "somethingNew"), "somethingNew"],
    [409, error(409, "conflict"), "conflict"],
    [400, "not json", "unknown"],
  ])(
    "refuses only that person on an unknown %i, and says so",
    (status, body, reason) => {
      expect(classifyShareResponse(status, body)).toEqual({
        kind: "refused",
        unexpected: { status, reason },
      });
    },
  );
});

describe("createDrivePermissionsClient", () => {
  it("lists every page and keeps only people other than the owner, by lower-cased address", async () => {
    const { drive, fetchImpl } = client([
      json(200, {
        nextPageToken: "page2",
        permissions: [
          {
            id: "p0",
            type: "user",
            role: "owner",
            emailAddress: "club@example.test",
          },
          {
            id: "p1",
            type: "user",
            role: "reader",
            emailAddress: "Sara@Example.test",
          },
          { id: "p2", type: "anyone", role: "reader" },
        ],
      }),
      json(200, {
        permissions: [
          {
            id: "p3",
            type: "group",
            role: "reader",
            emailAddress: "team@example.test",
          },
          {
            id: "p4",
            type: "user",
            role: "writer",
            emailAddress: "ali@example.test",
          },
        ],
      }),
    ]);
    expect(await drive.list("t", "file1")).toEqual({
      kind: "ok",
      value: [
        { id: "p1", email: "sara@example.test" },
        { id: "p4", email: "ali@example.test" },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [firstUrl] = fetchImpl.mock.calls[0];
    const [secondUrl] = fetchImpl.mock.calls[1];
    expect(firstUrl).toContain(`${DRIVE}/drive/v3/files/file1/permissions?`);
    expect(firstUrl).toContain("pageSize=2");
    expect(new URL(firstUrl).searchParams.get("fields")).toBe(
      "nextPageToken,permissions(id,type,role,emailAddress)",
    );
    expect(secondUrl).toContain("pageToken=page2");
  });

  it("shares view only and returns Google's id", async () => {
    const { drive, fetchImpl } = client([json(200, { id: "p9" })]);
    expect(await drive.create("t", "file1", "sara@example.test")).toEqual({
      kind: "ok",
      value: "p9",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${DRIVE}/drive/v3/files/file1/permissions?fields=id`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "user",
      role: "reader",
      emailAddress: "sara@example.test",
    });
  });

  it("reports a refusal for that person", async () => {
    const { drive } = client([json(400, error(400, "invalidSharingRequest"))]);
    expect(await drive.create("t", "file1", "x@example.test")).toEqual({
      kind: "refused",
      unexpected: null,
    });
  });

  it("treats a permission that is already gone as removed", async () => {
    const { drive, fetchImpl } = client([
      new Response(null, { status: 204 }),
      json(404, error(404, "notFound")),
    ]);
    expect(await drive.remove("t", "file1", "p1")).toEqual({
      kind: "ok",
      value: null,
    });
    expect(await drive.remove("t", "file1", "p1")).toEqual({
      kind: "ok",
      value: null,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${DRIVE}/drive/v3/files/file1/permissions/p1`);
    expect(init.method).toBe("DELETE");
  });

  it("turns a network error into a retry and never throws", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new Error("down"));
    const drive = createDrivePermissionsClient({
      driveBaseUrl: DRIVE,
      timeoutMs: 1_000,
      pageSize: 2,
      fetchImpl,
    });
    expect(await drive.list("t", "file1")).toEqual({
      kind: "retry",
      status: 0,
    });
    expect(await drive.create("t", "file1", "a@example.test")).toEqual({
      kind: "retry",
      status: 0,
    });
    expect(await drive.remove("t", "file1", "p1")).toEqual({
      kind: "retry",
      status: 0,
    });
  });
});
