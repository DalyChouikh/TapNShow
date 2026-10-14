"use client";

import { Check, EnvelopeSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";
import { Pill } from "@/components/ui/pill";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ShowMore } from "@/components/ui/show-more";
import { Skeleton } from "@/components/ui/skeleton";
import { Sticker } from "@/components/ui/sticker";
import { DEVICE_KEYS } from "@/config/members";
import { useMe } from "@/hooks/use-me";
import { useMyInvites } from "@/hooks/use-my-invites";
import { readDeviceValue, writeDeviceValue } from "@/lib/device/storage";
import { type WeekGroup, weekGroup } from "@/lib/my-invites/group";
import { useIsClient } from "@/lib/use-is-client";
import {
  type MyInvite,
  type MyInvitesFilter,
  myInvitesFilterSchema,
  type MyInvitesTab,
  myInvitesTabSchema,
} from "@/shared/api/my-invites";
import { InviteCard } from "./invite-card";

const GROUPS: readonly WeekGroup[] = ["thisWeek", "nextWeek", "later"];

function byWeek(items: MyInvite[], now: Date) {
  return GROUPS.map((group) => ({
    group,
    items: items.filter((item) => weekGroup(item.startsAt, now) === group),
  })).filter((section) => section.items.length > 0);
}

/** `/invites` (spec §7.4): Upcoming in date order with All / Needs your answer, and Past. */
export function InvitesView() {
  const t = useTranslations("MyInvites");
  const me = useMe();
  const isClient = useIsClient();
  const [tab, setTab] = useState<MyInvitesTab>("upcoming");
  // The chip picked in this visit, else the one remembered on this device (read only on the
  // client, so the pre-rendered page and hydration agree), else All.
  const [picked, setPicked] = useState<MyInvitesFilter | null>(null);
  const filter =
    picked ??
    (isClient
      ? readDeviceValue(DEVICE_KEYS.invitesFilter, myInvitesFilterSchema)
      : null) ??
    "all";
  const chosen = tab === "upcoming" ? filter : "all";
  const list = useMyInvites(tab, chosen, { enabled: isClient });
  const choose = (next: MyInvitesFilter) => {
    setPicked(next);
    writeDeviceValue(DEVICE_KEYS.invitesFilter, next);
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <SegmentedControl
        label={t("tabs.label")}
        value={tab}
        onValueChange={(value) => setTab(myInvitesTabSchema.parse(value))}
        options={[
          { value: "upcoming", label: t("tabs.upcoming") },
          { value: "past", label: t("tabs.past") },
        ]}
      />
      {tab === "upcoming" ? (
        <div
          role="group"
          aria-label={t("chips.label")}
          className={CHIP_ROW_CLASS}
        >
          <Chip
            pressed={filter === "all"}
            onPressedChange={() => choose("all")}
          >
            {t("chips.all")}
          </Chip>
          <Chip
            pressed={filter === "needs"}
            onPressedChange={() => choose("needs")}
          >
            {t("chips.needs")}
            {list.needsCount > 0 ? (
              <>
                {" "}
                <Pill tone="warning">{list.needsCount}</Pill>
              </>
            ) : null}
          </Chip>
        </div>
      ) : null}
      {list.query.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : list.items.length === 0 ? (
        <EmptyState
          tab={tab}
          filter={chosen}
          email={me.data?.profile.email ?? ""}
        />
      ) : tab === "upcoming" ? (
        byWeek(list.items, new Date()).map((section) => (
          <div key={section.group} className="flex flex-col gap-3">
            <h2 className="text-xs font-extrabold tracking-wide text-muted-ink uppercase">
              {t(`groups.${section.group}`)}
            </h2>
            {section.items.map((invite) => (
              <InviteCard key={invite.inviteeId} invite={invite} tab={tab} />
            ))}
          </div>
        ))
      ) : (
        <div className="flex flex-col gap-3">
          {list.items.map((invite) => (
            <InviteCard key={invite.inviteeId} invite={invite} tab={tab} />
          ))}
        </div>
      )}
      <ShowMore
        hasMore={list.hasMore}
        loading={list.isLoadingMore}
        onMore={list.loadMore}
      />
    </section>
  );
}

function EmptyState({
  tab,
  filter,
  email,
}: {
  tab: MyInvitesTab;
  filter: MyInvitesFilter;
  email: string;
}) {
  const t = useTranslations("MyInvites");
  if (filter === "needs") {
    return (
      <Card className="flex items-start gap-3">
        <Sticker tone="success">
          <Check weight="bold" />
        </Sticker>
        <div className="flex flex-col gap-1">
          <h2 className="font-bold">{t("caughtUp")}</h2>
          <p>{t("caughtUpBody")}</p>
        </div>
      </Card>
    );
  }
  if (tab === "past") {
    return <p className="text-muted-ink">{t("noPast")}</p>;
  }
  return (
    <>
      <Card className="flex items-start gap-3">
        <Sticker tone="info">
          <EnvelopeSimple weight="bold" />
        </Sticker>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-bold">{t("emptyTitle")}</h2>
          <p className="break-words">{t("emptyBody", { email })}</p>
          <p className="text-sm text-muted-ink">{t("otherAddress")}</p>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="font-bold">{t("organizing")}</p>
        <Button asChild tone="primary">
          <Link href="/w/new">{t("createWorkspace")}</Link>
        </Button>
      </Card>
    </>
  );
}
