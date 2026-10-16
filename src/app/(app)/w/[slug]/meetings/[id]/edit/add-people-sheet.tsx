"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PEOPLE_PER_ADD_MAX } from "@/config/meetings";
import { useAddPeople } from "@/hooks/use-meetings";
import { ApiClientError } from "@/lib/api-client";
import { parsePeopleList } from "@/lib/meetings/parse-people";
import { emailSchema } from "@/shared/api/common";

type Row = { key: number; fullName: string; email: string };
type RowError = { fullName?: string; email?: string };

let nextKey = 1;
const emptyRow = (): Row => ({ key: nextKey++, fullName: "", email: "" });

/** "Add people": several non-roster people at once (rows or a pasted list), saved to the roster by default. */
export function AddPeopleSheet({
  open,
  onOpenChange,
  slug,
  meetingId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  meetingId: string;
}) {
  const t = useTranslations("Wizard.addPeople");
  const tErrors = useTranslations("ApiErrors");
  const add = useAddPeople(slug, meetingId);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [errors, setErrors] = useState<Record<number, RowError>>({});
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [saveToRoster, setSaveToRoster] = useState(true);
  const filled = rows.filter((row) => row.fullName.trim() || row.email.trim());
  const parsedPaste = parsePeopleList(pasted);
  const reset = () => {
    setRows([emptyRow()]);
    setErrors({});
    setPasting(false);
    setPasted("");
    setSaveToRoster(true);
  };
  const close = (next: boolean) => {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  };
  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  const usePaste = () => {
    const incoming = parsedPaste.map((person) => ({
      key: nextKey++,
      fullName: person.fullName,
      email: person.email,
    }));
    setRows((current) =>
      [
        ...current.filter((row) => row.fullName.trim() || row.email.trim()),
        ...incoming,
      ].slice(0, PEOPLE_PER_ADD_MAX),
    );
    setPasting(false);
    setPasted("");
  };
  const submit = () => {
    const found: Record<number, RowError> = {};
    for (const row of filled) {
      const rowError: RowError = {};
      if (!row.fullName.trim()) {
        rowError.fullName = t("nameMissing");
      }
      if (!emailSchema.safeParse(row.email).success) {
        rowError.email = t("emailInvalid");
      }
      if (rowError.fullName || rowError.email) {
        found[row.key] = rowError;
      }
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || filled.length === 0) {
      return;
    }
    add.mutate(
      {
        people: filled.map((row) => ({
          fullName: row.fullName.trim(),
          email: emailSchema.parse(row.email),
        })),
        saveToRoster,
      },
      {
        onSuccess: ({ contactIds }) => {
          toast.success(t("added", { count: contactIds.length }));
          close(false);
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li
              key={row.key}
              className="flex flex-col gap-2 rounded-control border-[length:var(--tn-border-width)] border-outline p-3"
            >
              {rows.length > 1 ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-muted-ink">
                    {t("person", { number: index + 1 })}
                  </span>
                  <Button
                    aria-label={t("remove", { number: index + 1 })}
                    className="size-11 justify-center p-0"
                    onClick={() =>
                      setRows((current) =>
                        current.filter((r) => r.key !== row.key),
                      )
                    }
                  >
                    <Trash weight="bold" aria-hidden />
                  </Button>
                </div>
              ) : null}
              <Input
                id={`person-${row.key}-name`}
                label={t("fullName")}
                autoComplete="off"
                value={row.fullName}
                error={errors[row.key]?.fullName}
                onChange={(event) =>
                  update(row.key, { fullName: event.target.value })
                }
              />
              <Input
                id={`person-${row.key}-email`}
                label={t("email")}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={row.email}
                error={errors[row.key]?.email}
                onChange={(event) =>
                  update(row.key, { email: event.target.value })
                }
              />
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={rows.length >= PEOPLE_PER_ADD_MAX}
            onClick={() => setRows((current) => [...current, emptyRow()])}
          >
            <Plus weight="bold" aria-hidden />
            {t("another")}
          </Button>
          <Button tone="info" onClick={() => setPasting((value) => !value)}>
            {t("paste")}
          </Button>
        </div>
        {pasting ? (
          <div className="flex flex-col gap-2">
            <Textarea
              id="people-paste"
              label={t("pasteLabel")}
              placeholder={t("pastePlaceholder")}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
            <Button disabled={parsedPaste.length === 0} onClick={usePaste}>
              {t("usePaste", { count: parsedPaste.length })}
            </Button>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="save-to-roster" className="flex flex-col">
            <span className="font-bold">{t("saveToRoster")}</span>
            {!saveToRoster ? (
              <span className="text-sm text-muted-ink">
                {t("saveToRosterOff")}
              </span>
            ) : null}
          </label>
          <Switch
            id="save-to-roster"
            checked={saveToRoster}
            onCheckedChange={setSaveToRoster}
          />
        </div>
        {add.error instanceof ApiClientError ? (
          <p role="alert" className="font-bold">
            {tErrors(add.error.code)}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            size="lg"
            tone="primary"
            className="justify-center"
            disabled={add.isPending}
            onClick={submit}
          >
            {t("submit", { count: filled.length || 1 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
