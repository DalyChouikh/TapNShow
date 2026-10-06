"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ListPicker } from "@/components/forms/list-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateList, useImportContacts } from "@/hooks/use-roster";
import { ApiClientError } from "@/lib/api-client";
import { emailSchema } from "@/shared/api/common";
import { contactNameSchema, type Roster } from "@/shared/api/roster";
import { ListTag } from "./list-tag";

const schema = z.object({ fullName: contactNameSchema, email: emailSchema });
type Values = z.input<typeof schema>;

/**
 * "+ Add": one person through the import route (spec §6), so an email already in the roster
 * merges (name updated, lists added) instead of failing.
 */
export function AddContactDialog({
  slug,
  roster,
  open,
  onOpenChange,
}: {
  slug: string;
  roster: Roster;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const importContacts = useImportContacts(slug);
  const createList = useCreateList(slug);
  const [listIds, setListIds] = useState<string[]>([]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", email: "" },
  });

  const submit = form.handleSubmit((values) => {
    const parsed = schema.parse(values);
    const names = roster.lists
      .filter((list) => listIds.includes(list.id))
      .map((list) => list.name);
    importContacts.mutate(
      {
        rows: [
          {
            row: 1,
            fullName: parsed.fullName,
            email: parsed.email,
            lists: names,
          },
        ],
        dryRun: false,
      },
      {
        onSuccess: (result) => {
          const outcome = result.rows[0]?.outcome;
          const name = result.rows[0]?.fullName ?? parsed.fullName;
          if (outcome === "invalid") {
            form.setError("email", { message: t("invalidEmail") });
            return;
          }
          toast(
            outcome === "new"
              ? t("added", { name })
              : outcome === "updated"
                ? t("updatedExisting", { name })
                : t("alreadyThere", { name }),
          );
          form.reset();
          setListIds([]);
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error(
            tErrors(error instanceof ApiClientError ? error.code : "internal"),
          ),
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addTitle")}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Input
            id="add-name"
            label={t("nameLabel")}
            error={
              form.formState.errors.fullName ? t("invalidName") : undefined
            }
            {...form.register("fullName")}
          />
          <Input
            id="add-email"
            type="email"
            inputMode="email"
            label={t("emailLabel")}
            error={form.formState.errors.email ? t("invalidEmail") : undefined}
            {...form.register("email")}
          />
          <div className="flex flex-wrap items-center gap-2">
            {roster.lists
              .filter((list) => listIds.includes(list.id))
              .map((list) => (
                <ListTag key={list.id} list={list} />
              ))}
            <ListPicker
              lists={roster.lists}
              selectedIds={listIds}
              onChange={setListIds}
              onCreate={(name) => createList.mutateAsync(name)}
              triggerLabel={t("addToList")}
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              tone="primary"
              disabled={importContacts.isPending}
            >
              {t("addSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
