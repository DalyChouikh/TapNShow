"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-me";
import { useMembers } from "@/hooks/use-members";
import { useWorkspace } from "@/hooks/use-workspace";
import { DangerZone } from "./danger-zone";
import { GeneralSection } from "./general-section";
import { PeopleSection } from "./people-section";

/** `/w/[slug]/settings` (spec §10): General, People, Danger zone. */
export default function SettingsPage() {
  const t = useTranslations("Settings");
  const { slug } = useParams<{ slug: string }>();
  const workspace = useWorkspace(slug);
  const me = useMe();
  const members = useMembers(slug);
  if (!workspace.data || !me.data) {
    return <Skeleton className="h-64 w-full" />;
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <GeneralSection workspace={workspace.data} />
      <PeopleSection workspace={workspace.data} myId={me.data.userId} />
      {members.data ? (
        <DangerZone
          workspace={workspace.data}
          myId={me.data.userId}
          members={members.data}
        />
      ) : null}
    </div>
  );
}
