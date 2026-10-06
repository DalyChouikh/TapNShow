"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { QUERY_MAX_RETRIES, QUERY_STALE_TIME_MS } from "@/config/query";
import { ApiClientError } from "@/lib/api-client";

/** TanStack Query for all client data. 4xx errors are never retried. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: QUERY_STALE_TIME_MS,
            retry: (failureCount, error) =>
              !(error instanceof ApiClientError && error.status < 500) &&
              failureCount < QUERY_MAX_RETRIES,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
