"use client";

import { format, parseISO } from "date-fns";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { reportPercent } from "@/lib/admin/format";
import type { AdminLogItem } from "@/shared/api/admin";
import { useAdminFormat } from "./use-admin-format";

type Translate = ReturnType<typeof useTranslations<"Admin.log">>;

/** A fact the SQL stored as text, or "" (facts are counts and masked addresses only). */
function textFact(item: AdminLogItem, key: string): string {
  const value = item.facts[key];
  return typeof value === "string" ? value : "";
}

/**
 * One log line as a sentence (`Admin.log.kinds`): the actor's name (a removed account is "An
 * admin"), the workspace's name as it was, and the masked address the event stored.
 */
export function logSentence(item: AdminLogItem, t: Translate): string {
  return t(`kinds.${item.kind}`, {
    actor: item.actorName ?? t("someone"),
    workspace: item.workspaceName ?? "",
    email: textFact(item, "email"),
    lane: textFact(item, "lane"),
  });
}

/**
 * One admin log line (spec §7.19): the sentence, when, and the suspension rule's numbers when the
 * event carries them; it links to the workspace while the workspace exists.
 */
export function LogRow({ item }: { item: AdminLogItem }) {
  const t = useTranslations("Admin.log");
  const tReports = useTranslations("Admin.reports");
  const { percent } = useAdminFormat();
  const { reports, people } = item.facts;
  const numbers =
    typeof reports === "number" && typeof people === "number" && people > 0
      ? tReports("rate", {
          reports,
          people,
          percent: percent(reportPercent(reports, people)),
        })
      : null;
  const when = format(parseISO(item.createdAt), "d MMM HH:mm");
  const body = (
    <Card className="flex flex-col gap-1 p-3">
      <span className="font-bold break-words">{logSentence(item, t)}</span>
      <span className="text-sm text-muted-ink">
        {numbers ? `${when} · ${numbers}` : when}
      </span>
    </Card>
  );
  return item.workspaceId ? (
    <Link
      href={`/admin/workspaces/${item.workspaceId}`}
      className="block rounded-card focus-visible:outline-2"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
