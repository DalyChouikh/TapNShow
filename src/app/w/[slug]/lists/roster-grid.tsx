"use client";

import { CaretUpDown } from "@phosphor-icons/react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ListPicker } from "@/components/forms/list-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { ROSTER_CARD_ESTIMATE_PX } from "@/config/roster";
import { useCreateList, useUpdateContact } from "@/hooks/use-roster";
import { emailSchema } from "@/shared/api/common";
import {
  contactNameSchema,
  type Contact,
  type Roster,
} from "@/shared/api/roster";
import { describeEditError } from "./describe-edit-error";
import { EditableCell } from "./editable-cell";
import { ContactMark } from "@/components/forms/contact-mark";
import { ListTag } from "@/components/forms/list-tag";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text },
});
const helper = createColumnHelper<typeof features, Contact>();
const OVERSCAN = 10;
const GRID_ROW_ESTIMATE_PX = ROSTER_CARD_ESTIMATE_PX / 2;

/**
 * Wide-screen roster (spec §7.14): a virtualized table with inline-editable name and email,
 * list pills with the picker, sortable headers, and a checkbox column feeding the selection bar.
 * Viewers (`canEdit` false) get the same table read-only; a name opens the read-only sheet.
 */
export function RosterGrid({
  slug,
  contacts,
  roster,
  canEdit,
  selectedIds,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  slug: string;
  contacts: Contact[];
  roster: Roster;
  canEdit: boolean;
  selectedIds: ReadonlySet<string>;
  onToggle: (contactId: string) => void;
  onToggleAll: (contactIds: string[]) => void;
  onOpen: (contact: Contact) => void;
}) {
  const t = useTranslations("Lists");
  const tErrors = useTranslations("ApiErrors");
  const update = useUpdateContact(slug);
  const createList = useCreateList(slug);
  const [columns] = useState(() =>
    helper.columns([
      helper.accessor("fullName", {
        header: () => t("columnName"),
        sortFn: "text",
      }),
      helper.accessor("email", {
        header: () => t("columnEmail"),
        sortFn: "text",
      }),
    ]),
  );
  const table = useTable({
    features,
    columns,
    data: contacts,
    getRowId: (row) => row.id,
  });
  const rows = table.getRowModel().rows;
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  const scrollMargin = body?.offsetTop ?? 0;
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => GRID_ROW_ESTIMATE_PX,
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (index) => rows[index].id,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length ? items[0].start - scrollMargin : 0;
  const paddingBottom = items.length
    ? virtualizer.getTotalSize() - (items[items.length - 1].end - scrollMargin)
    : 0;
  const allShown =
    contacts.length > 0 && contacts.every((c) => selectedIds.has(c.id));
  const someShown = contacts.some((c) => selectedIds.has(c.id));
  const nameError = (value: string) =>
    contactNameSchema.safeParse(value).success ? null : t("invalidName");
  const emailError = (value: string) =>
    emailSchema.safeParse(value).success ? null : t("invalidEmail");

  return (
    <div className="overflow-x-auto rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface shadow-brutal">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          {canEdit ? <col className="w-14" /> : null}
          <col />
          <col />
          <col className="w-[34%]" />
        </colgroup>
        <thead className="bg-fill-primary text-on-fill">
          <tr>
            {canEdit ? (
              <th className="p-2">
                <Checkbox
                  checked={
                    allShown ? true : someShown ? "indeterminate" : false
                  }
                  onCheckedChange={() => onToggleAll(contacts.map((c) => c.id))}
                  aria-label={t("selectAll")}
                />
              </th>
            ) : null}
            {table.getHeaderGroups()[0].headers.map((header) => (
              <th key={header.id} className="p-2 text-left font-bold">
                <button
                  type="button"
                  aria-label={t("sortBy", {
                    column:
                      header.column.id === "fullName"
                        ? t("columnName")
                        : t("columnEmail"),
                  })}
                  onClick={header.column.getToggleSortingHandler()}
                  className="inline-flex min-h-11 items-center gap-1"
                >
                  <table.FlexRender header={header} />
                  <CaretUpDown weight="bold" aria-hidden />
                </button>
              </th>
            ))}
            <th className="p-2 text-left font-bold">{t("columnLists")}</th>
          </tr>
        </thead>
        <tbody ref={setBody}>
          {paddingTop > 0 ? (
            <tr aria-hidden>
              <td colSpan={canEdit ? 4 : 3} style={{ height: paddingTop }} />
            </tr>
          ) : null}
          {items.map((item) => {
            const contact = rows[item.index].original;
            const own = roster.lists.filter((list) =>
              contact.listIds.includes(list.id),
            );
            const save = (patch: {
              fullName?: string;
              email?: string;
              listIds?: string[];
            }) =>
              update.mutate(
                { id: contact.id, patch },
                {
                  onError: (error) => {
                    const { code, takenBy } = describeEditError(
                      error,
                      patch.email,
                      roster,
                    );
                    toast.error(
                      takenBy
                        ? t("emailTaken", { name: takenBy })
                        : tErrors(code),
                    );
                  },
                },
              );
            return (
              <tr
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="border-t-[length:var(--tn-border-width)] border-outline align-top"
              >
                {canEdit ? (
                  <td className="p-2">
                    <Checkbox
                      checked={selectedIds.has(contact.id)}
                      onCheckedChange={() => onToggle(contact.id)}
                      aria-label={t("selectPerson", { name: contact.fullName })}
                    />
                  </td>
                ) : null}
                {canEdit ? (
                  <>
                    <td className="p-1">
                      <EditableCell
                        value={contact.fullName}
                        label={t("editCell", {
                          column: t("columnName"),
                          name: contact.fullName,
                        })}
                        validate={nameError}
                        onCommit={(fullName) => save({ fullName })}
                        rowIndex={item.index}
                        columnIndex={1}
                      />
                      <span className="block px-2">
                        <ContactMark contact={contact} />
                      </span>
                    </td>
                    <td className="p-1">
                      <EditableCell
                        value={contact.email}
                        label={t("editCell", {
                          column: t("columnEmail"),
                          name: contact.fullName,
                        })}
                        validate={emailError}
                        onCommit={(email) =>
                          save({ email: emailSchema.parse(email) })
                        }
                        rowIndex={item.index}
                        columnIndex={2}
                        inputType="email"
                      />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-1">
                      <button
                        type="button"
                        onClick={() => onOpen(contact)}
                        className="min-h-11 w-full truncate rounded-control px-2 text-left text-sm font-bold"
                      >
                        {contact.fullName}
                      </button>
                      <span className="block px-2">
                        <ContactMark contact={contact} />
                      </span>
                    </td>
                    <td className="truncate p-2 text-sm">{contact.email}</td>
                  </>
                )}
                <td className="p-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {own.map((list) => (
                      <ListTag key={list.id} list={list} />
                    ))}
                    {canEdit ? (
                      <ListPicker
                        lists={roster.lists}
                        selectedIds={contact.listIds}
                        onChange={(listIds) => save({ listIds })}
                        onCreate={(name) => createList.mutateAsync(name)}
                        triggerLabel={t("addToList")}
                        triggerAriaLabel={t("addPersonToList", {
                          name: contact.fullName,
                        })}
                        triggerClassName="px-2 text-xs"
                      />
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
          {paddingBottom > 0 ? (
            <tr aria-hidden>
              <td colSpan={canEdit ? 4 : 3} style={{ height: paddingBottom }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
