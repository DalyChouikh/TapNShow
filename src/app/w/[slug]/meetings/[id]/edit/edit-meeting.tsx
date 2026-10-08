"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeeting } from "@/hooks/use-meetings";
import { useWorkspace } from "@/hooks/use-workspace";
import { WizardShell } from "./wizard-shell";

/** The wizard for one meeting; the step comes from `?step=` (spec §7.2). */
export function EditMeeting() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const params = useSearchParams();
  const meeting = useMeeting(slug, id);
  const workspace = useWorkspace(slug);
  if (!meeting.data || !workspace.data) {
    return <Skeleton className="h-96 w-full" />;
  }
  return (
    <WizardShell
      slug={slug}
      meeting={meeting.data}
      workspace={workspace.data}
      stepParam={params.get("step")}
    />
  );
}
