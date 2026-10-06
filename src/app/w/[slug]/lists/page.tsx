"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ComingSoon } from "@/components/shell/coming-soon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { publicEnv } from "@/config/public-env";
import { useRoster } from "@/hooks/use-roster";
import { useWorkspace } from "@/hooks/use-workspace";
import { RosterSkeleton } from "./roster-skeleton";
import { RosterView } from "./roster-view";

/** `/w/[slug]/lists` (spec §7.14); "coming soon" until the rollout flag is on (removed in Task 10). */
export default function ListsPage() {
  return publicEnv.NEXT_PUBLIC_ROSTER_ENABLED ? (
    <Roster />
  ) : (
    <ComingSoon area="lists" />
  );
}

function Roster() {
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
  return <RosterView workspace={workspace.data} roster={roster.data} />;
}
