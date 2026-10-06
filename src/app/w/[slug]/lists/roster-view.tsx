"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { filterContacts, type ListFilter } from "@/lib/roster/filter-contacts";
import type { Contact, Roster } from "@/shared/api/roster";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { ListChips } from "./list-chips";
import { RosterCards } from "./roster-cards";
import { RosterEmpty } from "./roster-empty";

/** The roster page body (spec §7.14). Editing arrives in Tasks 8–10. */
export function RosterView({
  workspace,
  roster,
}: {
  workspace: WorkspaceDetails;
  roster: Roster;
}) {
  const t = useTranslations("Lists");
  const [query, setQuery] = useState("");
  const [listId, setListId] = useState<ListFilter>(null);
  const canEdit = workspace.myRole !== "viewer";
  const visible = filterContacts(roster.contacts, { query, listId });
  const openContact: (contact: Contact) => void = () => undefined;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-sm text-muted-ink">
            {t("count", { count: roster.contacts.length })}
          </p>
        </div>
      </div>
      {roster.contacts.length === 0 && roster.lists.length === 0 ? (
        <RosterEmpty canEdit={canEdit} />
      ) : (
        <>
          <Input
            id="roster-search"
            type="search"
            label={t("searchLabel")}
            hideLabel
            placeholder={t("searchPlaceholder", {
              count: roster.contacts.length,
            })}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ListChips
            lists={roster.lists}
            total={roster.contacts.length}
            noListCount={
              roster.contacts.filter((contact) => contact.listIds.length === 0)
                .length
            }
            selectedListId={listId}
            onSelect={setListId}
          />
          {visible.length === 0 ? (
            <p className="py-6 text-center text-muted-ink">{t("noMatches")}</p>
          ) : (
            <RosterCards
              contacts={visible}
              lists={roster.lists}
              onOpen={openContact}
            />
          )}
        </>
      )}
    </section>
  );
}
