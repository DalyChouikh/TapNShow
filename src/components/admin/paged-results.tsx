"use client";

import type { ReactNode } from "react";
import { ShowMore } from "@/components/ui/show-more";
import { Skeleton } from "@/components/ui/skeleton";
import type { usePagedList } from "@/hooks/use-paged-list";
import { LoadError } from "@/components/errors/load-error";

/** What `usePagedList` returns, for any item type. */
type PagedList<T> = Omit<ReturnType<typeof usePagedList>, "items"> & {
  items: T[];
};

/**
 * An admin list's states in one place: the error card (when nothing loaded), skeletons, the empty
 * line, then the items (`children` lays them out) and Show more with the end line.
 */
export function PagedResults<T>({
  list,
  empty,
  end,
  children,
}: {
  list: PagedList<T>;
  empty: string;
  end: string;
  children: (items: T[]) => ReactNode;
}) {
  if (list.query.isError && list.items.length === 0) {
    return <LoadError onRetry={() => void list.query.refetch()} />;
  }
  if (list.query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (list.items.length === 0) {
    return <p className="py-6 text-center text-muted-ink">{empty}</p>;
  }
  return (
    <>
      {children(list.items)}
      <ShowMore
        hasMore={list.hasMore}
        loading={list.isLoadingMore}
        onMore={list.loadMore}
        endLabel={end}
      />
    </>
  );
}
