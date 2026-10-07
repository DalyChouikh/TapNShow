"use client";

import { Trash } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  useCreateList,
  useDeleteList,
  useRenameList,
} from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import { listNameSchema, type ListSummary } from "@/shared/api/roster";

/** Create, rename (on blur) and delete lists. Deleting a list never deletes its people. */
export function ManageListsDialog({
  slug,
  lists,
  open,
  onOpenChange,
}: {
  slug: string;
  lists: ListSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const create = useCreateList(slug);
  const rename = useRenameList(slug);
  const remove = useDeleteList(slug);
  const [newName, setNewName] = useState("");
  const [confirming, setConfirming] = useState<ListSummary | null>(null);
  const showError = (error: Error) =>
    toast.error(
      tErrors(error instanceof ApiClientError ? error.code : "internal"),
    );

  const submitNew = () => {
    const parsed = listNameSchema.safeParse(newName);
    if (parsed.success) {
      create.mutate(parsed.data, {
        onSuccess: () => setNewName(""),
        onError: showError,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("manageTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitNew();
          }}
        >
          <div className="flex-1">
            <Input
              id="new-list"
              label={t("newListLabel")}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <Button type="submit" tone="primary" disabled={create.isPending}>
            {t("createListAction")}
          </Button>
        </form>
        {lists.length === 0 ? (
          <p className="text-muted-ink">{t("manageEmpty")}</p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {lists.map((list) => (
            <li key={list.id} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  id={`list-${list.id}`}
                  label={t("renameLabel", { name: list.name })}
                  hideLabel
                  defaultValue={list.name}
                  onBlur={(event) => {
                    const parsed = listNameSchema.safeParse(event.target.value);
                    if (parsed.success && parsed.data !== list.name) {
                      rename.mutate(
                        { id: list.id, name: parsed.data },
                        { onError: showError },
                      );
                    }
                  }}
                />
              </div>
              <span className="pb-3 text-sm text-muted-ink">
                {list.contactCount}
              </span>
              <Button
                tone="danger"
                aria-label={t("deleteList", { name: list.name })}
                onClick={() => setConfirming(list)}
              >
                <Trash weight="bold" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        {confirming ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-control border-[length:var(--tn-border-width)] border-outline bg-fill-danger p-3 text-on-fill"
          >
            <p className="font-bold">
              {t("confirmDeleteList", { name: confirming.name })}
            </p>
            <div className="flex gap-2">
              <Button
                tone="danger"
                onClick={() =>
                  remove.mutate(confirming.id, {
                    onSuccess: () => setConfirming(null),
                    onError: showError,
                  })
                }
              >
                {t("confirmDeleteAction")}
              </Button>
              <Button onClick={() => setConfirming(null)}>{t("cancel")}</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
