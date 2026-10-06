import { z } from "zod";
import { workspaceRoleSchema } from "./me";

/** Workspace name rules (match the database check). */
export const workspaceNameSchema = z.string().trim().min(1).max(80);

/** IANA timezone name; the database validates it against `pg_timezone_names`. */
export const timezoneSchema = z.string().min(1).max(64);

/** `POST /api/workspaces` body. */
export const createWorkspaceBodySchema = z.object({
  name: workspaceNameSchema,
  timezone: timezoneSchema,
});

/** `POST /api/workspaces` response. */
export const createWorkspaceResponseSchema = z.object({ slug: z.string() });

/** `GET /api/workspaces/[slug]` response. */
export const workspaceDetailsSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  myRole: workspaceRoleSchema,
  canCheckIn: z.boolean(),
});

/** A workspace as seen by one of its members. */
export type WorkspaceDetails = z.infer<typeof workspaceDetailsSchema>;

/** `PATCH /api/workspaces/[slug]` body (Owner/Admin). */
export const updateWorkspaceBodySchema = z
  .object({
    name: workspaceNameSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.timezone !== undefined);
