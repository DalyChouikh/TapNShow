"use client";

import { UsersThree } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";

/** Empty roster: organizers get the import/paste/add actions (slot), Viewers a short note. */
export function RosterEmpty({
  canEdit,
  actions,
}: {
  canEdit: boolean;
  actions?: ReactNode;
}) {
  const t = useTranslations("Lists");
  return (
    <Card as="section" className="flex flex-col items-start gap-3">
      <Sticker tone="primary">
        <UsersThree weight="bold" />
      </Sticker>
      <h2 className="font-display text-2xl">
        {canEdit ? t("emptyTitle") : t("emptyViewerTitle")}
      </h2>
      <p className="text-muted-ink">
        {canEdit ? t("emptyBody") : t("emptyViewerBody")}
      </p>
      {canEdit && actions ? (
        <div className="flex w-full flex-col gap-3 sm:flex-row">{actions}</div>
      ) : null}
    </Card>
  );
}
