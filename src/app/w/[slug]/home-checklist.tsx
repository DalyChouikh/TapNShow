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
import { publicEnv } from "@/config/public-env";
import { useWorkspaceSender } from "@/hooks/use-sender";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

type StepKey =
  "inviteCommittee" | "importMembers" | "connectGmail" | "connectSheets";
type ActionKey =
  "inviteCommitteeAction" | "importMembersAction" | "connectGmailAction";

const STEPS: ReadonlyArray<{
  key: StepKey;
  icon: Icon;
  href?: (slug: string) => string;
  actionKey?: ActionKey;
}> = [
  {
    key: "inviteCommittee",
    icon: UserPlus,
    href: (slug) => `/w/${slug}/settings#people`,
    actionKey: "inviteCommitteeAction",
  },
  {
    key: "importMembers",
    icon: UploadSimple,
    href: (slug) => `/w/${slug}/lists`,
    actionKey: "importMembersAction",
  },
  // Gmail sending ships with the M4 meetings flag.
  publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED
    ? {
        key: "connectGmail",
        icon: EnvelopeSimple,
        href: (slug) => `/w/${slug}/settings#sending`,
        actionKey: "connectGmailAction",
      }
    : { key: "connectGmail", icon: EnvelopeSimple },
  { key: "connectSheets", icon: Table },
];

/** Home (spec §7.1): onboarding checklist for Owners/Admins, a short welcome for Viewers. */
export function HomeChecklist({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("WorkspaceHome");
  const sender = useWorkspaceSender(workspace.slug);
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
          {STEPS.map(({ key, icon: Glyph, href, actionKey }) => (
            <li key={key} className="flex items-center gap-3">
              <Sticker tone={href ? "primary" : "neutral"}>
                <Glyph weight="bold" />
              </Sticker>
              <span className="flex-1 font-bold">{t(key)}</span>
              {key === "connectGmail" && href ? (
                <GmailStatus
                  workspace={workspace}
                  active={sender.data?.sender?.status === "active"}
                  ownerName={sender.data?.ownerName}
                  href={href(workspace.slug)}
                />
              ) : href && actionKey ? (
                <Button asChild tone="primary">
                  <Link href={href(workspace.slug)}>{t(actionKey)}</Link>
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

/** The Gmail step: Done once a sender is active; the Owner connects, Admins are told who does. */
function GmailStatus({
  workspace,
  active,
  ownerName,
  href,
}: {
  workspace: WorkspaceDetails;
  active: boolean;
  ownerName: string | undefined;
  href: string;
}) {
  const t = useTranslations("WorkspaceHome");
  if (active) {
    return (
      <span className="rounded-full border-2 border-outline bg-fill-success px-2 text-xs font-bold text-on-fill">
        {t("done")}
      </span>
    );
  }
  if (workspace.myRole !== "owner") {
    return ownerName ? (
      <span className="max-w-32 text-right text-sm text-muted-ink">
        {t("ownerConnects", { owner: ownerName })}
      </span>
    ) : null;
  }
  return (
    <Button asChild tone="primary">
      <Link href={href}>{t("connectGmailAction")}</Link>
    </Button>
  );
}
