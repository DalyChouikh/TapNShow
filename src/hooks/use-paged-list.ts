"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { PAGE_SIZE_DEFAULT } from "@/config/pagination";
import { apiRequest } from "@/lib/api-client";

function pathWith(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

/**
 * A paged list endpoint (`{ items, nextCursor }`, plus any extra fields such as history counts)
 * as one growing list. Pages refetch together on
 * `refetchInterval` or invalidation, so live lists stay consistent (TanStack `useInfiniteQuery`).
 */
export function usePagedList<
  P extends { items: readonly object[]; nextCursor: string | null },
>(options: {
  queryKey: readonly (string | number)[];
  path: string;
  params?: Record<string, string>;
  schema: z.ZodType<P>;
  limit?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
}) {
  const params = options.params ?? {};
  const limit = options.limit ?? PAGE_SIZE_DEFAULT;
  const query = useInfiniteQuery({
    queryKey: [...options.queryKey, params, limit],
    queryFn: ({ pageParam }) =>
      apiRequest(
        pathWith(options.path, {
          ...params,
          limit: String(limit),
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
        { schema: options.schema },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: options.refetchInterval ?? false,
    refetchIntervalInBackground: false,
    enabled: options.enabled ?? true,
  });
  return {
    query,
    items: (query.data?.pages.flatMap((page) => page.items) ??
      []) as P["items"][number][],
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
  };
}
