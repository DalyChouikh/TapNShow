"use client";

import { useParams } from "next/navigation";
import { useNow } from "next-intl";
import type { ReactNode } from "react";
import { LoadError } from "@/components/errors/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { HOME_TWO_COLUMNS_MEDIA } from "@/config/home";
import { RELATIVE_TIME_TICK_MS } from "@/config/query";
import { useMe } from "@/hooks/use-me";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useWorkspaceInsights } from "@/hooks/use-results";
import { useWorkspace } from "@/hooks/use-workspace";
import { usePeriod } from "@/lib/responses/use-period";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { HomeChecklist } from "./home-checklist";
import { HomeGreeting } from "./home-greeting";
import { NeedsAttention } from "./needs-attention";
import { NextMeetingCard } from "./next-meeting-card";
import { SheetsTip } from "./sheets-tip";
import { useHomeSetup } from "./use-home-setup";

/** Home's cards in reading order: one column on phones, or the two columns from `lg`. */
type HomeLayout = { phone: ReactNode[]; main: ReactNode[]; side: ReactNode[] };

/** Workspace Home (spec §4, design 2026-10-17): what's next, what needs me, how it's going. */
export default function WorkspaceHomePage() {
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  if (!workspace.data) {
    return null;
  }
  return <WorkspaceHome workspace={workspace.data} />;
}

function WorkspaceHome({ workspace }: { workspace: WorkspaceDetails }) {
  const now = useNow({ updateInterval: RELATIVE_TIME_TICK_MS });
  // One period for every card: the same insights request feeds the greeting, setup and charts.
  const period = usePeriod(workspace.timezone);
  const insights = useWorkspaceInsights(workspace.slug, period.range);
  const setup = useHomeSetup(workspace.slug, period.range);
  const me = useMe();
  const wide = useMediaQuery(HOME_TWO_COLUMNS_MEDIA);
  const canManage = workspace.myRole !== "viewer";
  const firstName =
    me.data?.profile.displayName?.trim().split(/\s+/)[0] ?? null;

  const attention = <NeedsAttention key="attention" workspace={workspace} />;
  const next = (
    <NextMeetingCard
      key="next"
      slug={workspace.slug}
      canManage={canManage}
      now={now}
    />
  );
  let layout: HomeLayout;
  if (setup.state === "loading") {
    const loading = <Skeleton key="setup" className="h-64 w-full" />;
    layout = {
      phone: [attention, loading],
      main: [loading],
      side: [attention],
    };
  } else if (setup.state === "error") {
    const failed = <LoadError key="setup" onRetry={setup.retry} />;
    layout = {
      phone: [attention, failed, next],
      main: [failed, next],
      side: [attention],
    };
  } else if (!setup.complete) {
    const checklist = (
      <HomeChecklist key="setup" workspace={workspace} setup={setup} />
    );
    layout = {
      phone: [attention, checklist, next],
      main: [checklist],
      side: [attention, next],
    };
  } else {
    const sheetsTip = (
      <SheetsTip key="sheets" workspace={workspace} setup={setup} now={now} />
    );
    layout = {
      phone: [attention, next, sheetsTip],
      main: [next],
      side: [attention, sheetsTip],
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={wide ? undefined : "mx-auto w-full max-w-md"}>
        {setup.state === "loading" ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <HomeGreeting
            workspaceName={workspace.name}
            name={firstName}
            roster={insights.data?.roster}
            welcome={canManage && setup.state === "ready" && !setup.complete}
            now={now}
          />
        )}
      </div>
      {wide ? (
        <div className="grid grid-cols-[3fr_2fr] items-start gap-4">
          <div data-slot="main" className="flex min-w-0 flex-col gap-4">
            {layout.main}
          </div>
          <div data-slot="side" className="flex min-w-0 flex-col gap-4">
            {layout.side}
          </div>
        </div>
      ) : (
        <div
          data-slot="main"
          className="mx-auto flex w-full max-w-md flex-col gap-4"
        >
          {layout.phone}
        </div>
      )}
    </div>
  );
}
