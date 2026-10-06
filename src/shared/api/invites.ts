import { z } from "zod";
import { INVITE_BATCH_MAX } from "@/config/invites";
import { emailSchema } from "./common";
import { workspaceRoleSchema } from "./me";

/** How an invite reaches the person: platform email or a link the Admin copies. */
export const inviteDeliverySchema = z.enum(["email", "link"]);

/** Roles that can be invited (the Owner role only changes by transfer). */
export const invitableRoleSchema = z.enum(["admin", "viewer"]);

/** `POST /api/workspaces/[slug]/invites` body: up to INVITE_BATCH_MAX addresses, normalized, de-duplicated. */
export const createInviteBodySchema = z.object({
  emails: z
    .array(emailSchema)
    .min(1)
    .max(INVITE_BATCH_MAX)
    .transform((emails) => [...new Set(emails)]),
  role: invitableRoleSchema,
  delivery: inviteDeliverySchema,
});

/** What happened to one address of a batch. */
export const inviteResultStatusSchema = z.enum([
  "sent",
  "link",
  "already_member",
  "email_limit",
  "email_failed",
  "error",
]);

/** One row of the batch response; `inviteId` lets the UI offer "Copy link" for failed emails. */
export const inviteResultSchema = z.object({
  email: z.string(),
  status: inviteResultStatusSchema,
  inviteId: z.uuid().optional(),
  link: z.url().optional(),
});

/** A per-address batch result. */
export type InviteResult = z.infer<typeof inviteResultSchema>;

/** `POST /api/workspaces/[slug]/invites` response. */
export const inviteBatchResponseSchema = z.object({
  results: z.array(inviteResultSchema),
});

/** `POST …/invites/[id]/renew` body. */
export const renewInviteBodySchema = z.object({
  delivery: inviteDeliverySchema,
});

/** One open invite in Settings. */
export const inviteSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: invitableRoleSchema,
  status: z.enum(["pending", "expired"]),
  expiresAt: z.string(),
  createdAt: z.string(),
});

/** An open invite. */
export type Invite = z.infer<typeof inviteSchema>;

/** `GET …/invites` response. */
export const invitesResponseSchema = z.array(inviteSchema);

/** Result of create / renew. The link (and its token) is returned only for "link" delivery. */
export const inviteDeliveredSchema = z.discriminatedUnion("delivery", [
  z.object({ id: z.uuid(), delivery: z.literal("email") }),
  z.object({ id: z.uuid(), delivery: z.literal("link"), link: z.url() }),
]);

/** Body carrying an invite token (POST only: tokens never go in query strings). */
export const inviteTokenBodySchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

/** `POST /api/invites/preview` response. */
export const invitePreviewSchema = z.object({
  status: z.enum([
    "not_found",
    "revoked",
    "already_member",
    "used",
    "expired",
    "wrong_account",
    "ready",
  ]),
  workspaceName: z.string().nullable(),
  workspaceSlug: z.string().nullable(),
  role: workspaceRoleSchema.nullable(),
  maskedEmail: z.string().nullable(),
});

/** Invite preview shown on `/invite/[token]`. */
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/** `POST /api/invites/accept` response. */
export const acceptInviteResponseSchema = z.object({ slug: z.string() });
