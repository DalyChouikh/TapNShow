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

/** Why sharing with one person failed: Google refused that person, or the usual failures. */
export type ShareFailure = { kind: "refused" } | GoogleFailure;

/** Drive's answers that refuse one address (Drive "Resolve errors" guide, read 2026-10-20). */
const REFUSED = new Set(["invalidSharingRequest", "invalid"]);
const SHARING_RATE_LIMIT = "sharingRateLimitExceeded";

/**
 * Maps a non-2xx answer to `permissions.create` (design §5): a refusal for that address never
 * pauses the sheet; Drive's sharing rate limit (403, "often linked with an email limit") is a
 * retry; anything else is read like any Drive answer.
 */
export function classifyShareResponse(
  status: number,
  body: string,
): ShareFailure {
  const { reasons } = googleErrorReasons(body);
  if (status === 400 && reasons.some((reason) => REFUSED.has(reason))) {
    return { kind: "refused" };
  }
  if (status === 403 && reasons.includes(SHARING_RATE_LIMIT)) {
    return { kind: "retry", status };
  }
  return classifyGoogleResponse(status, body);
}

/** The Drive calls the share step makes on one file (plain `fetch`, like the Sheets client). */
export type DrivePermissionsClient = {
  /** Everyone shared as a person, every page followed, by lower-cased address. */
  list(token: string, fileId: string): Promise<GoogleResult<DrivePermission[]>>;
  /** Shares view only (Google's notification email stays on); Google's permission id. */
  create(
    token: string,
    fileId: string,
    email: string,
  ): Promise<GoogleResult<string> | { kind: "refused" }>;
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
          fields: "nextPageToken,permissions(id,type,emailAddress)",
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
          if (permission.type === "user" && permission.emailAddress) {
            people.push({
              id: permission.id,
              email: permission.emailAddress.toLowerCase(),
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
