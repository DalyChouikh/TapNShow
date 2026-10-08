"use client";

import { useParams } from "next/navigation";
import { publicEnv } from "@/config/public-env";
import { useWorkspace } from "@/hooks/use-workspace";
import { HomeChecklist } from "./home-checklist";
import { NeedsAttention } from "./needs-attention";

/** Workspace Home. The shell already handles loading and not-found. */
export default function WorkspaceHomePage() {
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  if (!workspace.data) {
    return null;
  }
  return (
    <div className="flex flex-col gap-4">
      {publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED ? (
        <NeedsAttention workspace={workspace.data} />
      ) : null}
      <HomeChecklist workspace={workspace.data} />
    </div>
  );
}
