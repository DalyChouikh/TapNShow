"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { UNDO_DELETE_MS } from "@/config/roster";
import { useBulkContacts, useDeleteContact } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import type { Contact } from "@/shared/api/roster";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * People hidden while their delete waits for the Undo toast, per workspace. Module-level (like the
 * global toaster), so leaving Lists and coming back within the Undo window still hides them (#119).
 */
const pending = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

function updatePending(
  slug: string,
  change: (current: ReadonlySet<string>) => ReadonlySet<string>,
) {
  pending.set(slug, change(pending.get(slug) ?? EMPTY));
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Delete with Undo (spec §7.14, grilling 2026-10-06): the people disappear at once and the delete
 * is sent only when the Undo toast goes away (auto-close or dismiss); Undo cancels it. The toast's
 * own lifetime decides, so a toast paused by hover, touch or a hidden tab can never offer Undo for
 * a delete that was already sent. Closing the tab first means nothing is deleted. The toaster is
 * global, so moving to another page keeps the Undo and still completes the delete. One person uses
 * the single route, several the bulk route.
 */
export function useDeferredDelete(slug: string): {
  pendingIds: ReadonlySet<string>;
  scheduleDelete: (contacts: Contact[]) => void;
} {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const removeOne = useDeleteContact(slug);
  const bulk = useBulkContacts(slug);
  const pendingIds = useSyncExternalStore(
    subscribe,
    () => pending.get(slug) ?? EMPTY,
    () => EMPTY,
  );

  const forget = (ids: readonly string[]) =>
    updatePending(
      slug,
      (current) => new Set([...current].filter((id) => !ids.includes(id))),
    );

  const scheduleDelete = (contacts: Contact[]) => {
    const ids = contacts.map((contact) => contact.id);
    if (ids.length === 0) {
      return;
    }
    updatePending(slug, (current) => new Set([...current, ...ids]));
    let settled = false;
    const send = () => {
      if (settled) {
        return;
      }
      settled = true;
      // mutateAsync's promise settles even after the page unmounted; mutate()'s per-call
      // callbacks would not run then, leaving the person hidden forever.
      const request =
        ids.length === 1
          ? removeOne.mutateAsync(ids[0])
          : bulk.mutateAsync({ action: "delete", contactIds: ids });
      request
        .catch((error: Error) =>
          toast.error(
            tErrors(error instanceof ApiClientError ? error.code : "internal"),
          ),
        )
        .finally(() => forget(ids));
    };
    toast(
      ids.length === 1
        ? t("deleted", { name: contacts[0].fullName })
        : t("deletedMany", { count: ids.length }),
      {
        duration: UNDO_DELETE_MS,
        onAutoClose: send,
        onDismiss: send,
        action: {
          label: t("undo"),
          // Runs before sonner's dismiss, so `send` then finds the delete settled.
          onClick: () => {
            if (settled) {
              return;
            }
            settled = true;
            forget(ids);
          },
        },
      },
    );
  };

  return { pendingIds, scheduleDelete };
}
