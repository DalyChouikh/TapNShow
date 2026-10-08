import { z } from "zod";
import { workspaceRoleSchema } from "./me";
import { pageSchema } from "./pagination";

/** One row of `GET /api/workspaces/[slug]/members`. */
export const memberSchema = z.object({
  userId: z.uuid(),
  role: workspaceRoleSchema,
  canCheckIn: z.boolean(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  email: z.string(),
  joinedAt: z.string(),
});

/** A workspace member as shown in Settings > People. */
export type Member = z.infer<typeof memberSchema>;

/** `GET …/members?role=&cursor=`: one page of members. */
export const membersPageSchema = pageSchema(memberSchema);

/** `PATCH …/members/[userId]` body. The Owner role only changes through transfer. */
export const changeRoleBodySchema = z.object({
  role: z.enum(["admin", "viewer"]),
  canCheckIn: z.boolean(),
});

/** Body of destructive actions confirmed by typing the workspace name. */
export const confirmNameBodySchema = z.object({
  confirmName: z.string().max(80),
});

/** `POST …/transfer` body. */
export const transferBodySchema = z.object({
  userId: z.uuid(),
  confirmName: z.string().max(80),
});
