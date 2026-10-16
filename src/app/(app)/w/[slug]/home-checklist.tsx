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
import { useWorkspaceSender } from "@/hooks/use-sender";
import { useWorkspaceSheet } from "@/hooks/use-sheet";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { Pill } from "@/components/ui/pill";
import { settingsPath } from "@/lib/with-query";

type StepKey =
  "inviteCommittee" | "importMembers" | "connectGmail" | "connectSheets";
type ActionKey =
  | "inviteCommitteeAction"
  | "importMembersAction"
  | "connectGmailAction"
  | "connectSheetsAction";

const STEPS: ReadonlyArray<{
  key: StepKey;
  icon: Icon;
  href: (slug: string) => string;
  actionKey: ActionKey;
}> = [
  {
    key: "inviteCommittee",
    icon: UserPlus,
    href: (slug) => settingsPath(slug, "people"),
    actionKey: "inviteCommitteeAction",
  },
  {
    key: "importMembers",
    icon: UploadSimple,
    href: (slug) => `/w/${slug}/lists`,
    actionKey: "importMembersAction",
  },
  {
    key: "connectGmail",
    icon: EnvelopeSimple,
    href: (slug) => settingsPath(slug, "sending"),
    actionKey: "connectGmailAction",
  },
  {
    key: "connectSheets",
    icon: Table,
    // Settings, not Google: the privacy text is always read before connecting.
    href: (slug) => settingsPath(slug, "sheets"),
    actionKey: "connectSheetsAction",
  },
];

/** Home (spec §7.1): onboarding checklist for Owners/Admins, a short welcome for Viewers. */
export function HomeChecklist({ workspace }: { workspace: WorkspaceDetails }) {
  const t = useTranslations("WorkspaceHome");
  const sender = useWorkspaceSender(workspace.slug);
  const sheet = useWorkspaceSheet(workspace.slug);
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
              <Sticker tone="primary">
                <Glyph weight="bold" />
              </Sticker>
              <span className="flex-1 font-bold">{t(key)}</span>
              {key === "connectGmail" ? (
                <ConnectStatus
                  done={sender.data?.sender?.status === "active"}
                  isOwner={workspace.myRole === "owner"}
                  ownerText={
                    sender.data &&
                    t("ownerConnects", { owner: sender.data.ownerName })
                  }
                  href={href(workspace.slug)}
                  action={t(actionKey)}
                />
              ) : key === "connectSheets" ? (
                <ConnectStatus
                  done={sheet.data !== undefined && sheet.data.state !== "off"}
                  isOwner={workspace.myRole === "owner"}
                  ownerText={
                    sheet.data &&
                    t("ownerConnectsSheets", { owner: sheet.data.ownerName })
                  }
                  href={href(workspace.slug)}
                  action={t(actionKey)}
                />
              ) : (
                <Button asChild tone="primary">
                  <Link href={href(workspace.slug)}>{t(actionKey)}</Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/**
 * A connect step (Gmail, Google Sheets): Done once connected; the Owner gets the link, Admins are
 * told who connects it.
 */
function ConnectStatus({
  done,
  isOwner,
  ownerText,
  href,
  action,
}: {
  done: boolean;
  isOwner: boolean;
  ownerText: string | undefined;
  href: string;
  action: string;
}) {
  const t = useTranslations("WorkspaceHome");
  if (done) {
    return <Pill tone="success">{t("done")}</Pill>;
  }
  if (!isOwner) {
    return ownerText ? (
      <span className="max-w-32 text-right text-sm text-muted-ink">
        {ownerText}
      </span>
    ) : null;
  }
  return (
    <Button asChild tone="primary">
      <Link href={href}>{action}</Link>
    </Button>
  );
}
