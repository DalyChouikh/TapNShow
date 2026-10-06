"use client";

import {
  EnvelopeSimple,
  Eye,
  Table,
  UploadSimple,
  UserPlus,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

const STEPS: ReadonlyArray<{
  key: "inviteCommittee" | "importMembers" | "connectGmail" | "connectSheets";
  icon: Icon;
  available: boolean;
}> = [
  { key: "inviteCommittee", icon: UserPlus, available: true },
  { key: "importMembers", icon: UploadSimple, available: false },
  { key: "connectGmail", icon: EnvelopeSimple, available: false },
  { key: "connectSheets", icon: Table, available: false },
];

/** Home (spec §7.1): onboarding checklist for Owners/Admins, a short welcome for Viewers. */
export function HomeChecklist({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("WorkspaceHome");
  if (workspace.myRole === "viewer") {
    return (
      <Card as="section" className="flex flex-col gap-3">
        <Sticker tone="info">
          <Eye weight="bold" />
        </Sticker>
        <h1 className="font-display text-2xl">
          {t("viewerTitle", { workspace: workspace.name })}
        </h1>
        <p className="text-muted-ink">{t("viewerBody")}</p>
      </Card>
    );
  }
  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">
        {t("title", { workspace: workspace.name })}
      </h1>
      <Card as="section">
        <h2 className="font-display text-xl">{t("checklistTitle")}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {STEPS.map(({ key, icon: Glyph, available }) => (
            <li key={key} className="flex items-center gap-3">
              <Sticker tone={available ? "primary" : "neutral"}>
                <Glyph weight="bold" />
              </Sticker>
              <span className="flex-1 font-bold">{t(key)}</span>
              {available ? (
                <Button asChild tone="primary">
                  <Link href={`/w/${workspace.slug}/settings#people`}>
                    {t("inviteCommitteeAction")}
                  </Link>
                </Button>
              ) : (
                <span className="rounded-full border-2 border-outline bg-fill-neutral px-2 text-xs font-bold text-on-fill">
                  {t("soon")}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
