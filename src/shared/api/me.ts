import { z } from "zod";

/** Workspace role names (mirror of Postgres enum `workspace_role`). */
export const workspaceRoleSchema = z.enum(["owner", "admin", "viewer"]);

/** A workspace role. */
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

/** Display name rules shared with the database check (1–80 characters after trimming). */
export const displayNameSchema = z.string().trim().min(1).max(80);

/** `GET /api/me` response. */
export const meResponseSchema = z.object({
  userId: z.uuid(),
  profile: z.object({
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    email: z.string().nullable(),
  }),
  workspaces: z.array(
    z.object({
      id: z.uuid(),
      slug: z.string(),
      name: z.string(),
      role: workspaceRoleSchema,
    }),
  ),
  lastWorkspaceSlug: z.string().nullable(),
});

/** Signed-in user's profile and memberships. */
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `PATCH /api/me` body. */
export const mePatchBodySchema = z
  .object({
    displayName: displayNameSchema.optional(),
    lastWorkspaceId: z.uuid().optional(),
  })
  .refine(
    (body) =>
      body.displayName !== undefined || body.lastWorkspaceId !== undefined,
  );
