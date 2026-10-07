"use client";

import { Trash, X } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ListPicker } from "@/components/forms/list-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateList, useUpdateContact } from "@/hooks/use-roster";
import { emailSchema } from "@/shared/api/common";
import {
  contactNameSchema,
  type Contact,
  type Roster,
  type UpdateContactBody,
} from "@/shared/api/roster";
import { describeEditError } from "./describe-edit-error";
import { ListTag } from "./list-tag";

type Field = "fullName" | "email";
type SaveState = "idle" | "saving" | "saved";

/**
 * Bottom-sheet editor for one person (spec §7.14). Each field saves when it loses focus if it
 * changed and is valid; lists save on every change. Viewers get the same sheet read-only.
 */
export function ContactSheet({
  slug,
  contact,
  roster,
  canEdit,
  onClose,
  onDelete,
}: {
  slug: string;
  contact: Contact;
  roster: Roster;
  canEdit: boolean;
  onClose: () => void;
  onDelete: (contact: Contact) => void;
}) {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const update = useUpdateContact(slug);
  const createList = useCreateList(slug);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const current = roster.contacts.find((c) => c.id === contact.id) ?? contact;
  const own = roster.lists.filter((list) => current.listIds.includes(list.id));

  const save = (patch: UpdateContactBody, field?: Field) => {
    setSaveState("saving");
    update.mutate(
      { id: contact.id, patch },
      {
        onSuccess: () => setSaveState("saved"),
        onError: (error) => {
          setSaveState("idle");
          const { code, takenBy } = describeEditError(
            error,
            patch.email,
            roster,
          );
          const message = takenBy
            ? t("emailTaken", { name: takenBy })
            : tErrors(code);
          if (field) {
            setErrors((previous) => ({ ...previous, [field]: message }));
          }
        },
      },
    );
  };

  const onBlur = (field: Field, raw: string) => {
    const parsed = (
      field === "email" ? emailSchema : contactNameSchema
    ).safeParse(raw);
    if (!parsed.success) {
      setErrors((previous) => ({
        ...previous,
        [field]: field === "email" ? t("invalidEmail") : t("invalidName"),
      }));
      return;
    }
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    if (parsed.data !== current[field]) {
      save({ [field]: parsed.data }, field);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{canEdit ? t("editTitle") : t("viewTitle")}</DialogTitle>
          <DialogDescription className="break-all">
            {current.email}
          </DialogDescription>
        </DialogHeader>
        {canEdit ? (
          <div className="flex flex-col gap-4">
            <Input
              id="sheet-name"
              label={t("nameLabel")}
              defaultValue={current.fullName}
              error={errors.fullName}
              onBlur={(event) => onBlur("fullName", event.target.value)}
            />
            <Input
              id="sheet-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              label={t("emailLabel")}
              defaultValue={current.email}
              error={errors.email}
              onBlur={(event) => onBlur("email", event.target.value)}
            />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-bold">{t("listsLabel")}</span>
              <div className="flex flex-wrap items-center gap-2">
                {own.map((list) => (
                  <span
                    key={list.id}
                    className="inline-flex items-center gap-1"
                  >
                    <ListTag list={list} />
                    <button
                      type="button"
                      aria-label={t("removeFromList", { list: list.name })}
                      onClick={() =>
                        save({
                          listIds: current.listIds.filter(
                            (id) => id !== list.id,
                          ),
                        })
                      }
                      className="inline-flex size-11 items-center justify-center rounded-full"
                    >
                      <X weight="bold" aria-hidden />
                    </button>
                  </span>
                ))}
                <ListPicker
                  lists={roster.lists}
                  selectedIds={current.listIds}
                  onChange={(listIds) => save({ listIds })}
                  onCreate={(name) => createList.mutateAsync(name)}
                  triggerLabel={t("addToList")}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Button tone="danger" onClick={() => onDelete(current)}>
                <Trash weight="bold" aria-hidden />
                {t("delete")}
              </Button>
              <p aria-live="polite" className="text-sm text-muted-ink">
                {saveState === "saving"
                  ? t("saving")
                  : saveState === "saved"
                    ? t("saved")
                    : ""}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="font-bold">{t("nameLabel")}</dt>
              <dd className="break-words">{current.fullName}</dd>
              <dt className="font-bold">{t("listsLabel")}</dt>
              <dd className="flex flex-wrap gap-1">
                {own.length
                  ? own.map((list) => <ListTag key={list.id} list={list} />)
                  : t("noListsYet")}
              </dd>
            </dl>
            <p className="text-sm text-muted-ink">{t("readOnly")}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
