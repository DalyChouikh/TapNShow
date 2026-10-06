import type { NextRequest, NextResponse } from "next/server";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { forbidViewer } from "@/server/http/forbid-viewer";
import { loadWorkspaceContext } from "@/server/http/workspace-context";
import {
  deleteContact,
  setContactLists,
  updateContact,
} from "@/server/queries/roster";
import { updateContactBodySchema } from "@/shared/api/roster";

type Ctx = RouteContext<"/api/workspaces/[slug]/contacts/[id]">;

const UNIQUE_EMAIL = { "23505": "contact_email_taken" } as const;

/** Edits one person: name and/or email, and/or replaces their lists (sheet autosave). */
export async function PATCH(
  request: NextRequest | Request,
  ctx: Ctx,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const body = await parseJsonBody(request, updateContactBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const { fullName, email, listIds } = body.data;
  if (fullName !== undefined || email !== undefined) {
    const updated = await updateContact(context.supabase, {
      workspaceId: context.workspace.id,
      contactId: id,
      fullName,
      email,
    });
    if (updated.error) {
      return fromDatabaseError(updated.error, UNIQUE_EMAIL);
    }
    if (!updated.data?.length) {
      return apiError("not_found");
    }
  }
  if (listIds !== undefined) {
    const { error } = await setContactLists(context.supabase, id, listIds);
    if (error) {
      return fromDatabaseError(error);
    }
  }
  return ok();
}

/** Deletes one person (sent after the Undo window closes). */
export async function DELETE(
  request: NextRequest | Request,
  ctx: Ctx,
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const { slug, id } = await ctx.params;
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context.response;
  }
  const denied = forbidViewer(context.workspace);
  if (denied) {
    return denied;
  }
  const { data, error } = await deleteContact(
    context.supabase,
    context.workspace.id,
    id,
  );
  if (error) {
    return fromDatabaseError(error);
  }
  return data?.length ? ok() : apiError("not_found");
}
