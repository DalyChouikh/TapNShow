"use client";

import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { maskEmail } from "@/lib/mask-email";
import type { AdminWorkspace } from "@/shared/api/admin";
import { FactList } from "./fact-list";
import { StatTile } from "./stat-tile";
import { useAdminFormat } from "./use-admin-format";

/** "Amira · a•••@gmail.com": the Owner email is shown masked (copied in full elsewhere). */
function ownerText(
  workspace: AdminWorkspace,
  t: ReturnType<typeof useTranslations<"Admin">>,
): string {
  const email = workspace.ownerEmail ? maskEmail(workspace.ownerEmail) : null;
  if (workspace.ownerName && email) {
    return t("workspace.ownerValue", { name: workspace.ownerName, email });
  }
  return workspace.ownerName ?? email ?? t("noValue");
}

/**
 * One workspace's facts and its last 30 days (spec §7.19). Counts and workspace-level facts only:
 * never a member's name, address, answer or meeting title.
 */
export function WorkspaceFacts({ workspace }: { workspace: AdminWorkspace }) {
  const t = useTranslations("Admin");
  const { count, delivered } = useAdminFormat();
  const { last30 } = workspace;
  const deliveredLine = delivered(
    last30.emailsSent - last30.emailsFailed,
    last30.emailsSent,
  );
  const emailsLine =
    last30.emailsFailed > 0
      ? t("workspace.emailsLine", {
          delivered: deliveredLine,
          failed: count(last30.emailsFailed),
        })
      : deliveredLine;
  return (
    <>
      <Card
        as="section"
        aria-labelledby="admin-workspace-facts"
        className="flex flex-col gap-3"
      >
        <h2 id="admin-workspace-facts" className="font-bold">
          {t("workspace.facts")}
        </h2>
        <FactList
          facts={[
            {
              label: t("workspace.created"),
              value: format(parseISO(workspace.createdAt), "d MMM yyyy"),
            },
            { label: t("workspace.owner"), value: ownerText(workspace, t) },
            {
              label: t("workspace.team"),
              value: t("workspace.teamValue", workspace.team),
            },
            { label: t("workspace.people"), value: count(workspace.contacts) },
            {
              label: t("workspace.sender"),
              value: t(`workspace.sender_${workspace.sender}`),
            },
            {
              label: t("workspace.sheet"),
              value: t(`workspace.sheet_${workspace.sheet}`),
            },
          ]}
        />
      </Card>
      <section
        aria-labelledby="admin-workspace-last30"
        className="flex flex-col gap-3"
      >
        <h2 id="admin-workspace-last30" className="font-display text-xl">
          {t("workspace.last30")}
        </h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            label={t("workspace.meetingsSent")}
            value={count(last30.meetingsSent)}
          />
          <StatTile
            label={t("workspace.emailsSent")}
            value={count(last30.emailsSent)}
            line={emailsLine}
          />
          <StatTile
            label={t("workspace.reports")}
            value={count(last30.reports)}
          />
          <StatTile
            label={t("workspace.unsubscribes")}
            value={count(last30.unsubscribes)}
          />
        </dl>
      </section>
    </>
  );
}
