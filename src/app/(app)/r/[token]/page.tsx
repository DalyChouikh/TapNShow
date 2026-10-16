import { Suspense } from "react";
import { PublicPage } from "@/components/public/public-page";
import { Skeleton } from "@/components/ui/skeleton";
import { AnswerView } from "./answer-view";

/** `/r/[token]`: a member's personal answer page (spec §7.3). No session needed. */
export default function Page() {
  return (
    <PublicPage>
      {/* AnswerView reads ?choice= through useSearchParams. */}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <AnswerView />
      </Suspense>
    </PublicPage>
  );
}
