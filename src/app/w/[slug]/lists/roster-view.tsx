"use client";

import { Plus } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { ROSTER_GRID_MEDIA } from "@/config/roster";
import { useMediaQuery } from "@/hooks/use-media-query";
import { filterContacts, type ListFilter } from "@/lib/roster/filter-contacts";
import { withListCounts } from "@/lib/roster/roster-cache";
import type { Contact, Roster } from "@/shared/api/roster";
import type { WorkspaceDetails } from "@/shared/api/workspaces";
import { AddContactDialog } from "./add-contact-dialog";
import { ContactSheet } from "./contact-sheet";
import { ListChips } from "./list-chips";
import { ManageListsDialog } from "./manage-lists-dialog";
import { RosterCards } from "./roster-cards";
import { RosterEmpty } from "./roster-empty";
import { RosterGrid } from "./roster-grid";
import { SelectionBar } from "./selection-bar";
import { useDeferredDelete } from "./use-deferred-delete";

/** The roster page body (spec §7.14): search, list chips, people, and the editors. */
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
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const { pendingIds, scheduleDelete } = useDeferredDelete(workspace.slug);
  const wide = useMediaQuery(ROSTER_GRID_MEDIA);
  const canEdit = workspace.myRole !== "viewer";

  // People waiting out their Undo window are already gone from the user's point of view.
  const live = withListCounts({
    ...roster,
    contacts: roster.contacts.filter((contact) => !pendingIds.has(contact.id)),
  });
  const people = live.contacts;
  const visible = filterContacts(people, { query, listId });
  const openContact = people.find((contact) => contact.id === openContactId);
  const openContactSheet = (contact: Contact) => setOpenContactId(contact.id);
  // Deleted people drop out of the selection.
  const liveSelection: ReadonlySet<string> = new Set(
    [...selectedIds].filter((id) => people.some((c) => c.id === id)),
  );
  const toggle = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  const toggleAll = (ids: string[]) =>
    setSelectedIds((current) =>
      ids.every((id) => current.has(id))
        ? new Set([...current].filter((id) => !ids.includes(id)))
        : new Set([...current, ...ids]),
    );
  const clear = () => {
    setSelectedIds(new Set());
    setSelecting(false);
  };

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-sm text-muted-ink">
            {t("count", { count: people.length })}
          </p>
        </div>
        {canEdit ? (
          <Button tone="primary" onClick={() => setAdding(true)}>
            <Plus weight="bold" aria-hidden />
            {t("add")}
          </Button>
        ) : null}
      </div>
      {people.length === 0 && live.lists.length === 0 ? (
        <RosterEmpty
          canEdit={canEdit}
          actions={
            <Button tone="primary" onClick={() => setAdding(true)}>
              {t("add")}
            </Button>
          }
        />
      ) : (
        <>
          <Input
            id="roster-search"
            type="search"
            label={t("searchLabel")}
            hideLabel
            placeholder={t("searchPlaceholder", { count: people.length })}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ListChips
            lists={live.lists}
            total={people.length}
            noListCount={
              people.filter((contact) => contact.listIds.length === 0).length
            }
            selectedListId={listId}
            onSelect={setListId}
            trailing={
              canEdit ? (
                <>
                  <Chip
                    pressed={false}
                    onPressedChange={() => setManaging(true)}
                    className="shrink-0"
                  >
                    {t("manage")}
                  </Chip>
                  {!wide ? (
                    <Chip
                      pressed={selecting}
                      onPressedChange={(on) =>
                        on ? setSelecting(true) : clear()
                      }
                      className="shrink-0"
                    >
                      {selecting ? t("doneSelecting") : t("select")}
                    </Chip>
                  ) : null}
                </>
              ) : undefined
            }
          />
          {visible.length === 0 ? (
            <p className="py-6 text-center text-muted-ink">{t("noMatches")}</p>
          ) : wide ? (
            <RosterGrid
              slug={workspace.slug}
              contacts={visible}
              roster={live}
              canEdit={canEdit}
              selectedIds={liveSelection}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onOpen={openContactSheet}
            />
          ) : (
            <RosterCards
              contacts={visible}
              lists={live.lists}
              onOpen={openContactSheet}
              selection={
                selecting && canEdit
                  ? { selectedIds: liveSelection, onToggle: toggle }
                  : undefined
              }
            />
          )}
        </>
      )}
      {canEdit && liveSelection.size > 0 ? (
        // Room to scroll the last people above the fixed selection bar.
        <div aria-hidden data-testid="selection-spacer" className="h-48" />
      ) : null}
      {canEdit && liveSelection.size > 0 ? (
        <SelectionBar
          slug={workspace.slug}
          roster={live}
          selectedIds={liveSelection}
          onClear={clear}
          onDelete={(ids) =>
            scheduleDelete(people.filter((c) => ids.includes(c.id)))
          }
        />
      ) : null}
      {openContact ? (
        <ContactSheet
          key={openContact.id}
          slug={workspace.slug}
          contact={openContact}
          roster={live}
          canEdit={canEdit}
          onClose={() => setOpenContactId(null)}
          onDelete={(contact) => {
            setOpenContactId(null);
            scheduleDelete([contact]);
          }}
        />
      ) : null}
      {canEdit ? (
        <>
          <AddContactDialog
            slug={workspace.slug}
            roster={live}
            open={adding}
            onOpenChange={setAdding}
          />
          <ManageListsDialog
            slug={workspace.slug}
            lists={live.lists}
            open={managing}
            onOpenChange={setManaging}
          />
        </>
      ) : null}
    </section>
  );
}
