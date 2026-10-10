"use client";

import { UserPlus } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AUDIENCE_PAGE_SIZE } from "@/config/meetings";
import { useMeetingAudience, useSetAudience } from "@/hooks/use-meetings";
import { useRoster } from "@/hooks/use-roster";
import { togglePerson, toggleList } from "@/lib/meetings/audience-edit";
import { normalizeForSearch } from "@/lib/roster/filter-contacts";
import { AddPeopleSheet } from "./add-people-sheet";
import { AudiencePersonRow } from "./audience-person-row";
import { WizardFooter } from "./wizard-footer";
import { stepAfter, stepBefore, type WizardStepProps } from "./wizard-steps";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";

/** Step 2 (or Invite more): lists first, then untick individuals; "Add people" for anyone else. */
export function AudienceStep({ slug, meeting, steps, goTo }: WizardStepProps) {
  const t = useTranslations("Wizard");
  const roster = useRoster(slug);
  const audience = useMeetingAudience(slug, meeting.id);
  const setAudience = useSetAudience(slug, meeting.id);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(AUDIENCE_PAGE_SIZE);
  const [adding, setAdding] = useState(false);
  const people = useMemo(() => audience.data?.people ?? [], [audience.data]);
  const visible = useMemo(() => {
    const query = normalizeForSearch(search);
    return query
      ? people.filter((p) =>
          normalizeForSearch(`${p.fullName} ${p.email}`).includes(query),
        )
      : people;
  }, [people, search]);
  if (!audience.data || !roster.data) {
    return <Skeleton className="h-96 w-full" />;
  }
  const data = audience.data;
  const lists = roster.data.lists;
  const inviteMore = meeting.status === "scheduled";
  const overlap = people.filter(
    (p) => !p.excluded && p.listIds.length > 1,
  ).length;
  const extra = people.filter((p) => p.added && p.listIds.length === 0);
  const before = stepBefore(steps, "audience");
  const after = stepAfter(steps, "audience");
  const back = () => (before ? goTo(before) : history.back());
  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={t("audience.lists")}
        className={CHIP_ROW_CLASS}
      >
        {lists.map((list) => (
          <Chip
            key={list.id}
            className="shrink-0"
            pressed={data.listIds.includes(list.id)}
            onPressedChange={() =>
              setAudience.mutate((current) => toggleList(current, list.id))
            }
          >
            {list.name} {list.contactCount}
          </Chip>
        ))}
      </div>
      <Card className="flex flex-col gap-0.5 bg-fill-warning text-on-fill">
        <span className="font-display text-lg">
          {t("audience.count", { count: data.counts.selected })}
        </span>
        {overlap > 0 ? (
          <span className="text-sm">
            {t("audience.overlap", { count: overlap })}
          </span>
        ) : null}
        {data.counts.unsubscribed > 0 ? (
          <span className="text-sm">
            {t("audience.unsubscribed", { count: data.counts.unsubscribed })}
          </span>
        ) : null}
      </Card>
      {people.length === 0 ? (
        <p className="text-muted-ink">{t("audience.noPeople")}</p>
      ) : (
        <Card className="flex flex-col gap-2">
          <Input
            id="audience-search"
            type="search"
            label={t("audience.search", { count: data.counts.selected })}
            hideLabel
            placeholder={t("audience.search", { count: data.counts.selected })}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {visible.length === 0 ? (
            <p className="text-muted-ink">{t("audience.noMatch")}</p>
          ) : null}
          <ul>
            {visible.slice(0, shown).map((person) => (
              <AudiencePersonRow
                key={person.id}
                person={person}
                lists={lists}
                onToggle={(included) =>
                  setAudience.mutate((current) =>
                    togglePerson(current, person.id, included),
                  )
                }
              />
            ))}
          </ul>
          {visible.length > shown ? (
            <Button
              onClick={() => setShown((count) => count + AUDIENCE_PAGE_SIZE)}
            >
              {t("audience.showMore", {
                count: Math.min(AUDIENCE_PAGE_SIZE, visible.length - shown),
              })}
            </Button>
          ) : null}
        </Card>
      )}
      <Card className="flex flex-col gap-2 bg-fill-success text-on-fill">
        <span className="font-bold">
          {t("audience.extra", { count: extra.length })}
        </span>
        {extra.length > 0 ? (
          <span className="text-sm break-words">
            {extra.map((p) => p.fullName).join(", ")}
          </span>
        ) : null}
        <Button className="justify-center" onClick={() => setAdding(true)}>
          <UserPlus weight="bold" aria-hidden />
          {t("audience.addPeople")}
        </Button>
      </Card>
      {setAudience.isError ? (
        <p role="alert" className="font-bold">
          {t("errors.saveFailed")}
        </p>
      ) : null}
      <AddPeopleSheet
        open={adding}
        onOpenChange={setAdding}
        slug={slug}
        meetingId={meeting.id}
      />
      <WizardFooter
        backLabel={before ? t("back") : t("cancel")}
        onBack={back}
        nextLabel={
          inviteMore
            ? t("audience.nextReview", { count: data.counts.toInvite })
            : t("audience.next", { count: data.counts.toInvite })
        }
        nextDisabled={data.counts.toInvite === 0}
        pending={setAudience.isPending}
        onNext={() => (after ? goTo(after) : undefined)}
      />
    </div>
  );
}
