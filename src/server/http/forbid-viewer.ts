import "server-only";
import type { NextResponse } from "next/server";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { apiError } from "./errors";

/** 403 for Viewers on roster writes (RLS refuses them too; this answers early and clearly). */
export function forbidViewer(workspace: WorkspaceDetails): NextResponse | null {
  return workspace.myRole === "viewer" ? apiError("forbidden") : null;
}
