"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-me";
import { useWorkspace } from "@/hooks/use-workspace";
import { DangerZone } from "./danger-zone";
import { GeneralSection } from "./general-section";
import { InvitesPanel } from "./invites-panel";
import { MeetingDefaultsSection } from "./meeting-defaults-section";
import { PeopleSection } from "./people-section";
import { SendingSection } from "./sending-section";

/**
 * `/w/[slug]/settings` (spec §10): General, Sending, Meeting defaults, People, Danger zone. Only
 * General starts open; the rest fold under their headings (a `#section` link opens its own).
 */
export default function SettingsPage() {
  const t = useTranslations("Settings");
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  const me = useMe();
  if (!workspace.data || !me.data) {
    return <Skeleton className="h-64 w-full" />;
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <GeneralSection key={workspace.data.id} workspace={workspace.data} />
      {/* SendingSection reads ?gmail=… through useSearchParams. */}
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <SendingSection workspace={workspace.data} defaultOpen={false} />
      </Suspense>
      <MeetingDefaultsSection workspace={workspace.data} defaultOpen={false} />
      <PeopleSection
        workspace={workspace.data}
        myId={me.data.userId}
        defaultOpen={false}
      >
        <InvitesPanel workspace={workspace.data} />
      </PeopleSection>
      <DangerZone
        workspace={workspace.data}
        defaultOpen={false}
        myId={me.data.userId}
      />
    </div>
  );
}
