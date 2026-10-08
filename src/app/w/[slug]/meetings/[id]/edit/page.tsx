import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EditMeeting } from "./edit-meeting";

/** `/w/[slug]/meetings/[id]/edit?step=…` — `useSearchParams` needs a Suspense boundary. */
export default function EditMeetingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <EditMeeting />
    </Suspense>
  );
}
