"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useState } from "react";
import { Chip } from "@/components/ui/chip";
import { CHIP_ROW_CLASS } from "@/components/ui/chip-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ShowMore } from "@/components/ui/show-more";
import { Skeleton } from "@/components/ui/skeleton";
import { SEARCH_DEBOUNCE_MS } from "@/config/meetings";
import { useAdminWorkspaces } from "@/hooks/use-admin";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  ADMIN_WORKSPACE_FILTERS,
  ADMIN_WORKSPACE_SORTS,
} from "@/shared/api/admin";
import { AdminLoadError } from "./load-error";
import { WorkspaceRow } from "./workspace-row";
import { WorkspaceTable } from "./workspace-table";

type Filter = (typeof ADMIN_WORKSPACE_FILTERS)[number];
type Sort = (typeof ADMIN_WORKSPACE_SORTS)[number];

/** `value` when it is one of `options`, else the first option (the default). */
function oneOf<T extends string>(
  options: readonly T[],
  value: string | null,
): T {
  return options.find((option) => option === value) ?? options[0];
}

/** The view as a query string, defaults left out (`q`, `filter`, `sort`). */
function viewQuery(view: { q: string; filter: Filter; sort: Sort }): string {
  const params = new URLSearchParams();
  if (view.q) {
    params.set("q", view.q);
  }
  if (view.filter !== ADMIN_WORKSPACE_FILTERS[0]) {
    params.set("filter", view.filter);
  }
  if (view.sort !== ADMIN_WORKSPACE_SORTS[0]) {
    params.set("sort", view.sort);
  }
  return params.toString();
}

/**
 * `/admin/workspaces` (spec §7.19): search by name or Owner email, filter, sort, 25 at a time;
 * cards up to tablets, a table from lg up (beside the side menu it needs the width). The address keeps the view, so Back returns to it.
 */
export function AdminWorkspacesView() {
  const t = useTranslations("Admin.workspaces");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [filter, setFilter] = useState(() =>
    oneOf(ADMIN_WORKSPACE_FILTERS, params.get("filter")),
  );
  const [sort, setSort] = useState(() =>
    oneOf(ADMIN_WORKSPACE_SORTS, params.get("sort")),
  );
  const q = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const list = useAdminWorkspaces({ q, filter, sort });

  const keepInAddress = useEffectEvent((query: string) => {
    if (query !== params.toString()) {
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    }
  });
  useEffect(() => {
    keepInAddress(viewQuery({ q, filter, sort }));
  }, [q, filter, sort]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-3xl">{t("title")}</h1>
      <Input
        id="admin-workspace-search"
        type="search"
        label={t("search")}
        hideLabel
        placeholder={t("search")}
        autoComplete="off"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div
          role="radiogroup"
          aria-label={t("filterLabel")}
          className={CHIP_ROW_CLASS}
        >
          {ADMIN_WORKSPACE_FILTERS.map((option) => (
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
        <Select
          value={sort}
          onValueChange={(value) =>
            setSort(oneOf(ADMIN_WORKSPACE_SORTS, value))
          }
        >
          <SelectTrigger aria-label={t("sort.label")} className="md:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADMIN_WORKSPACE_SORTS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`sort.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {list.query.isError && list.items.length === 0 ? (
        <AdminLoadError onRetry={() => void list.query.refetch()} />
      ) : list.query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : list.items.length === 0 ? (
        <p className="py-6 text-center text-muted-ink">{t("empty")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3 lg:hidden">
            {list.items.map((row) => (
              <li key={row.id}>
                <WorkspaceRow row={row} />
              </li>
            ))}
          </ul>
          <div className="hidden lg:block">
            <WorkspaceTable rows={list.items} />
          </div>
          <ShowMore
            hasMore={list.hasMore}
            loading={list.isLoadingMore}
            onMore={list.loadMore}
            endLabel={t("end")}
          />
        </>
      )}
    </div>
  );
}
