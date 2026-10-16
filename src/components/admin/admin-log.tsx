"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Chip } from "@/components/ui/chip";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";
import { useAdminLog } from "@/hooks/use-admin";
import { ADMIN_LOG_FILTERS } from "@/shared/api/admin";
import { LogRow } from "./log-row";
import { PagedResults } from "./paged-results";

/** `/admin/log` (spec §7.19): every suspension, report review and admin change, newest first. */
export function AdminLogView() {
  const t = useTranslations("Admin.log");
  const [filter, setFilter] =
    useState<(typeof ADMIN_LOG_FILTERS)[number]>("all");
  const list = useAdminLog(filter);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <div
        role="radiogroup"
        aria-label={t("filterLabel")}
        className={CHIP_ROW_CLASS}
      >
        {ADMIN_LOG_FILTERS.map((option) => (
          <Chip
            key={option}
            role="radio"
            pressed={filter === option}
            onPressedChange={() => setFilter(option)}
          >
            {t(`filters.${option}`)}
          </Chip>
        ))}
      </div>
      <PagedResults list={list} empty={t("empty")} end={t("end")}>
        {(items) => (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id}>
                <LogRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </PagedResults>
    </div>
  );
}
