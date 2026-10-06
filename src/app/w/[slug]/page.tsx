"use client";

import { useParams } from "next/navigation";
import { useWorkspace } from "@/hooks/use-workspace";
import { HomeChecklist } from "./home-checklist";

/** Workspace Home. The shell already handles loading and not-found. */
export default function WorkspaceHomePage() {
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  return workspace.data ? <HomeChecklist workspace={workspace.data} /> : null;
}
