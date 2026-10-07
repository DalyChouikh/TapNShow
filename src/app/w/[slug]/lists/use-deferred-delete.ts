"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { UNDO_DELETE_MS } from "@/config/roster";
import { useBulkContacts, useDeleteContact } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import type { Contact } from "@/shared/api/roster";

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
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const forget = (ids: readonly string[]) =>
    setPendingIds(
      (current) => new Set([...current].filter((id) => !ids.includes(id))),
    );

  const scheduleDelete = (contacts: Contact[]) => {
    const ids = contacts.map((contact) => contact.id);
    if (ids.length === 0) {
      return;
    }
    setPendingIds((current) => new Set([...current, ...ids]));
    const callbacks = {
      onSettled: () => forget(ids),
      onError: (error: Error) =>
        toast.error(
          tErrors(error instanceof ApiClientError ? error.code : "internal"),
        ),
    };
    let settled = false;
    const send = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (ids.length === 1) {
        removeOne.mutate(ids[0], callbacks);
      } else {
        bulk.mutate({ action: "delete", contactIds: ids }, callbacks);
      }
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
