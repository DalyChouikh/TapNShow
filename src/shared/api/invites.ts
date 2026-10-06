import { z } from "zod";
import { emailSchema } from "./common";
import { workspaceRoleSchema } from "./me";

/** How an invite reaches the person: platform email or a link the Admin copies. */
export const inviteDeliverySchema = z.enum(["email", "link"]);

/** Roles that can be invited (the Owner role only changes by transfer). */
export const invitableRoleSchema = z.enum(["admin", "viewer"]);

/** `POST /api/workspaces/[slug]/invites` body. */
export const createInviteBodySchema = z.object({
  email: emailSchema,
  role: invitableRoleSchema,
  delivery: inviteDeliverySchema,
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
