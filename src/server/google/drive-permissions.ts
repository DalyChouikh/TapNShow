import "server-only";
import { z } from "zod";
import type { DrivePermission } from "@/lib/sheets/share-plan";
import {
  classifyGoogleResponse,
  type FetchLike,
  type GoogleFailure,
  type GoogleResult,
  googleCall,
  googleErrorReasons,
} from "./google-call";

/**
 * Google refused to share with one person. `unexpected` names an answer outside Drive's known
 * refusals, reported so the mapping can grow (never an address: Google's reason code only).
 */
export type ShareRefusal = {
  kind: "refused";
  unexpected: { status: number; reason: string } | null;
};

/** Why sharing with one person failed: Google refused that person, or the usual failures. */
export type ShareFailure = ShareRefusal | GoogleFailure;

/**
 * Drive's answers that refuse one address (Drive "Resolve errors" guide, read 2026-10-20; the
 * plan's Task 4): `invalidSharingRequest` (also "ACL change not allowed"), `invalid` and
 * `badRequest` on the address (400), `forbidden` for that address (403).
 */
const REFUSED = new Set([
  "invalidSharingRequest",
  "invalid",
  "badRequest",
  "forbidden",
]);
const SHARING_RATE_LIMIT = "sharingRateLimitExceeded";
/** Client errors Drive uses for the whole request, not the address: the token, a gone file, a timeout or a rate limit. */
const WHOLE_REQUEST = new Set([401, 404, 408, 429]);

/**
 * Maps a non-2xx answer to `permissions.create` (design §5). A share is only tried right after
 * `permissions.list` answered for this file and token, so a client error is about that address:
 * it refuses that person only and never pauses the sheet (an unknown one is reported). Rate limits
 * (Drive's sharing limit is a 403, "often linked with an email limit") retry; a stale token, a gone
 * file, our own setup (a disabled API) and server errors are read like any Drive answer.
 */
export function classifyShareResponse(
  status: number,
  body: string,
): ShareFailure {
  const { reasons } = googleErrorReasons(body);
  if (status === 403 && reasons.includes(SHARING_RATE_LIMIT)) {
    return { kind: "retry", status };
  }
  const read = classifyGoogleResponse(status, body);
  if (status < 400 || status >= 500 || WHOLE_REQUEST.has(status)) {
    return read;
  }
  // A 403 rate limit, or our own setup (a disabled API).
  if (status === 403 && (read.kind === "retry" || read.kind === "bug")) {
    return read;
  }
  return reasons.some((reason) => REFUSED.has(reason))
    ? { kind: "refused", unexpected: null }
    : {
        kind: "refused",
        unexpected: { status, reason: reasons[0] ?? "unknown" },
      };
}

/** The Drive calls the share step makes on one file (plain `fetch`, like the Sheets client). */
export type DrivePermissionsClient = {
  /** Everyone shared as a person except the file's owner, every page followed, by lower-cased address. */
  list(token: string, fileId: string): Promise<GoogleResult<DrivePermission[]>>;
  /** Shares view only (Google's notification email stays on); Google's permission id. */
  create(
    token: string,
    fileId: string,
    email: string,
  ): Promise<GoogleResult<string> | ShareRefusal>;
  /** Removes one permission; one that is already gone counts as removed (404, the spike). */
  remove(
    token: string,
    fileId: string,
    permissionId: string,
  ): Promise<GoogleResult<null>>;
};

const pageSchema = z.object({
  nextPageToken: z.string().optional(),
  permissions: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.string(),
        role: z.string().optional(),
        emailAddress: z.string().optional(),
      }),
    )
    .default([]),
});
const createdSchema = z.object({ id: z.string().min(1) });

/** A client for one run; never throws (a network failure or a timeout is a retry). */
export function createDrivePermissionsClient(input: {
  driveBaseUrl: string;
  timeoutMs: number;
  pageSize: number;
  fetchImpl?: FetchLike;
}): DrivePermissionsClient {
  const fetchImpl: FetchLike =
    input.fetchImpl ?? ((url, init) => fetch(url, init));
  const base = (fileId: string) =>
    `${input.driveBaseUrl}/drive/v3/files/${encodeURIComponent(fileId)}/permissions`;
  return {
    list: async (token, fileId) => {
      const people: DrivePermission[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          pageSize: String(input.pageSize),
          fields: "nextPageToken,permissions(id,type,role,emailAddress)",
          ...(pageToken ? { pageToken } : {}),
        });
        const page = await googleCall({
          fetchImpl,
          timeoutMs: input.timeoutMs,
          token,
          url: `${base(fileId)}?${params.toString()}`,
          method: "GET",
          schema: pageSchema,
          classify: classifyGoogleResponse,
        });
        if (page.kind !== "ok") {
          return page;
        }
        for (const permission of page.value.permissions) {
          // The account that owns the file is never shared with nor removed.
          if (
            permission.type === "user" &&
            permission.role !== "owner" &&
            permission.emailAddress
          ) {
            people.push({
              id: permission.id,
              email: permission.emailAddress.toLowerCase(),
              viewOnly: permission.role === "reader",
            });
          }
        }
        pageToken = page.value.nextPageToken;
      } while (pageToken);
      return { kind: "ok", value: people };
    },
    create: async (token, fileId, email) => {
      const created = await googleCall({
        fetchImpl,
        timeoutMs: input.timeoutMs,
        token,
        url: `${base(fileId)}?fields=id`,
        method: "POST",
        body: { type: "user", role: "reader", emailAddress: email },
        schema: createdSchema,
        classify: classifyShareResponse,
      });
      return created.kind === "ok"
        ? { kind: "ok", value: created.value.id }
        : created;
    },
    remove: async (token, fileId, permissionId) => {
      const removed = await googleCall({
        fetchImpl,
        timeoutMs: input.timeoutMs,
        token,
        url: `${base(fileId)}/${encodeURIComponent(permissionId)}`,
        method: "DELETE",
        schema: z.object({}).transform(() => null),
        classify: classifyGoogleResponse,
      });
      return removed.kind === "not_found"
        ? { kind: "ok", value: null }
        : removed;
    },
  };
}
