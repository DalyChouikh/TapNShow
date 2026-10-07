"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ListPicker } from "@/components/forms/list-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBulkContacts, useCreateList } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import type { Roster } from "@/shared/api/roster";

/**
 * Sticky actions for the selected people (Select mode on phones, checkbox column on wider screens).
 * Delete confirms, then hands the ids to the parent's deferred delete, so it gets the 5 s Undo too.
 */
export function SelectionBar({
  slug,
  roster,
  selectedIds,
  onClear,
  onDelete,
}: {
  slug: string;
  roster: Roster;
  selectedIds: ReadonlySet<string>;
  onClear: () => void;
  onDelete: (contactIds: string[]) => void;
}) {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const bulk = useBulkContacts(slug);
  const createList = useCreateList(slug);
  const [confirming, setConfirming] = useState(false);
  const contactIds = [...selectedIds];
  const count = contactIds.length;
  const selectedLists = roster.lists.filter((list) =>
    roster.contacts.some(
      (contact) =>
        selectedIds.has(contact.id) && contact.listIds.includes(list.id),
    ),
  );
  // Lists created from the picker are not in `roster` until the next render; remember their names.
  const createdNames = useRef(new Map<string, string>());
  const nameOf = (listId: string) =>
    roster.lists.find((list) => list.id === listId)?.name ??
    createdNames.current.get(listId) ??
    "";
  const createAndRemember = async (name: string) => {
    const created = await createList.mutateAsync(name);
    createdNames.current.set(created.id, created.name);
    return created;
  };
  const onError = (error: Error) =>
    toast.error(
      tErrors(error instanceof ApiClientError ? error.code : "internal"),
    );

  const toList = (action: "addToList" | "removeFromList", listId: string) =>
    bulk.mutate(
      { action, contactIds, listId },
      {
        onSuccess: ({ affected }) => {
          toast(
            t(action === "addToList" ? "bulkAdded" : "bulkRemoved", {
              count: affected,
              list: nameOf(listId),
            }),
          );
          onClear();
        },
        onError,
      },
    );

  return (
    <div
      role="region"
      aria-label={t("selectedCount", { count })}
      className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-3 shadow-brutal-lg data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 motion-reduce:animate-none"
      data-state="open"
    >
      <span className="font-bold">{t("selectedCount", { count })}</span>
      <ListPicker
        mode="single"
        lists={roster.lists}
        selectedIds={[]}
        onChange={([listId]) => toList("addToList", listId)}
        onCreate={createAndRemember}
        triggerLabel={t("bulkAdd")}
        disabled={bulk.isPending}
      />
      <ListPicker
        mode="single"
        lists={selectedLists}
        selectedIds={[]}
        onChange={([listId]) => toList("removeFromList", listId)}
        triggerLabel={t("bulkRemove")}
        disabled={bulk.isPending || selectedLists.length === 0}
      />
      <Button
        tone="danger"
        onClick={() => setConfirming(true)}
        disabled={bulk.isPending}
      >
        {t("bulkDelete", { count })}
      </Button>
      <Button onClick={onClear}>{t("clearSelection")}</Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bulkDeleteTitle", { count })}</DialogTitle>
            <DialogDescription>{t("bulkDeleteBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirming(false)}>{t("cancel")}</Button>
            <Button
              tone="danger"
              onClick={() => {
                setConfirming(false);
                onDelete(contactIds);
                onClear();
              }}
            >
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
