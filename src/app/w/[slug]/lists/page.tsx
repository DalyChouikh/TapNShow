"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRoster } from "@/hooks/use-roster";
import { useWorkspace } from "@/hooks/use-workspace";
import { RosterSkeleton } from "./roster-skeleton";
import { RosterView } from "./roster-view";

/** `/w/[slug]/lists` (spec §7.14): the roster and its lists. */
export default function ListsPage() {
  const t = useTranslations("Lists");
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  const roster = useRoster(slug);
  if (roster.isError) {
    return (
      <Card as="section" className="flex flex-col items-start gap-3">
        <p>{t("loadError")}</p>
        <Button tone="primary" onClick={() => void roster.refetch()}>
          {t("retry")}
        </Button>
      </Card>
    );
  }
  if (!workspace.data || !roster.data) {
    return <RosterSkeleton />;
  }
  return (
    // RosterView reads ?view= and ?person= through useSearchParams.
    <Suspense fallback={<RosterSkeleton />}>
      <RosterView workspace={workspace.data} roster={roster.data} />
    </Suspense>
  );
}
