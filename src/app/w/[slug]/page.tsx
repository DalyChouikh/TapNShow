"use client";

import { useParams } from "next/navigation";
import { useWorkspace } from "@/hooks/use-workspace";
import { HomeChecklist } from "./home-checklist";
import { NeedsAttention } from "./needs-attention";
import { NextMeetingCard } from "./next-meeting-card";

/** Workspace Home: needs attention, the next meeting, the checklist. */
export default function WorkspaceHomePage() {
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  if (!workspace.data) {
    return null;
  }
  return (
    <div className="flex flex-col gap-4">
      <NeedsAttention workspace={workspace.data} />
      <HomeChecklist workspace={workspace.data} />
      <NextMeetingCard slug={slug} />
    </div>
  );
}
