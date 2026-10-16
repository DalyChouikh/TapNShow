"use client";

import {
  EnvelopeSimple,
  Flag,
  PauseCircle,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Sticker, type StickerTone } from "@/components/ui/sticker";
import {
  ATTENTION_SUSPENSIONS_SHOWN,
  PLATFORM_EMAIL_WARN_SHARE,
} from "@/config/admin";
import { RELATIVE_TIME_TICK_MS } from "@/config/query";
import type { AdminOverview } from "@/shared/api/admin";

type Item = {
  key: string;
  href?: string;
  tone: StickerTone;
  glyph: Icon;
  title: string;
  body?: string;
};

function ItemBody({ item }: { item: Item }) {
  const Glyph = item.glyph;
  return (
    <Card className="flex items-start gap-3 p-3">
      <Sticker tone={item.tone}>
        <Glyph weight="bold" />
      </Sticker>
      <span className="flex min-w-0 flex-col">
        <span className="font-bold break-words">{item.title}</span>
        {item.body ? (
          <span className="text-sm text-muted-ink">{item.body}</span>
        ) : null}
      </span>
    </Card>
  );
}

/**
 * The Overview's first block (spec §7.19): new reports, the open suspensions (the first few one by
 * one, the rest behind the Suspended filter) and a nearly full platform email budget, each
 * leading where it is handled.
 */
export function AttentionList({
  attention,
}: {
  attention: AdminOverview["attention"];
}) {
  const t = useTranslations("Admin.attention");
  const format = useFormatter();
  const now = useNow({ updateInterval: RELATIVE_TIME_TICK_MS });
  const items: Item[] = [];
  if (attention.newReports > 0) {
    items.push({
      key: "reports",
      href: "/admin/reports",
      tone: "danger",
      glyph: Flag,
      title: t("reports", { count: attention.newReports }),
      body: t("reportsBody"),
    });
  }
  const suspensions = attention.openSuspensions;
  for (const suspension of suspensions.slice(0, ATTENTION_SUSPENSIONS_SHOWN)) {
    const time = format.relativeTime(new Date(suspension.createdAt), now);
    items.push({
      key: suspension.workspaceId,
      href: `/admin/workspaces/${suspension.workspaceId}`,
      tone: "warning",
      glyph: PauseCircle,
      title: t("suspended", { name: suspension.workspaceName }),
      body:
        suspension.reason === "auto_reports"
          ? t("suspendedAuto", { time })
          : t("suspendedAdmin", { time }),
    });
  }
  const hidden = suspensions.length - ATTENTION_SUSPENSIONS_SHOWN;
  if (hidden > 0) {
    items.push({
      key: "more-suspended",
      href: "/admin/workspaces?filter=suspended",
      tone: "warning",
      glyph: PauseCircle,
      title: t("moreSuspended", { count: hidden }),
    });
  }
  const emailWarning =
    attention.platformEmailUsed >=
    attention.platformEmailCap * PLATFORM_EMAIL_WARN_SHARE;
  if (emailWarning) {
    items.push({
      key: "email",
      tone: "info",
      glyph: EnvelopeSimple,
      title: t("email", {
        used: attention.platformEmailUsed,
        cap: attention.platformEmailCap,
      }),
      body: t("emailBody"),
    });
  }
  // Every open suspension counts, including those behind "N more".
  const count =
    (attention.newReports > 0 ? 1 : 0) +
    suspensions.length +
    (emailWarning ? 1 : 0);
  return (
    <section aria-labelledby="admin-attention" className="flex flex-col gap-3">
      <h2 id="admin-attention" className="font-display text-xl">
        {count > 0 ? t("title", { count }) : t("heading")}
      </h2>
      {items.length === 0 ? (
        <Card className="p-3">
          <p>{t("none")}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.key}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="block rounded-card focus-visible:outline-2"
                >
                  <ItemBody item={item} />
                </Link>
              ) : (
                <ItemBody item={item} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
