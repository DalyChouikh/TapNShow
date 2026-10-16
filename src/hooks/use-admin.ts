"use client";

import {
  keepPreviousData,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import type { z } from "zod";
import { ADMIN_PAGE_SIZE } from "@/config/admin";
import { usePagedList } from "@/hooks/use-paged-list";
import { ME_QUERY_KEY } from "@/hooks/use-me";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import {
  type ADMIN_LOG_FILTERS,
  type ADMIN_WORKSPACE_FILTERS,
  type ADMIN_WORKSPACE_SORTS,
  adminAdminsSchema,
  adminInvitePreviewSchema,
  adminInviteResultSchema,
  adminLogPageSchema,
  adminOverviewSchema,
  adminReportsPageSchema,
  adminWorkspaceSchema,
  adminWorkspacesPageSchema,
} from "@/shared/api/admin";
import { okSchema } from "@/shared/api/common";

/** Query key prefix of everything in the admin area (every admin write invalidates it). */
export const ADMIN_QUERY_KEY = ["admin"] as const;

const ADMIN_API = "/api/admin";

function isAdminKey(key: QueryKey | undefined): boolean {
  return key?.[0] === ADMIN_QUERY_KEY[0];
}

/**
 * Watches every admin read and write while the admin area is open (spec §7.19, M9 Review Focus 5):
 * the API answers 404 to anyone who is no longer an admin, so a 404 fetches `/api/me` again and
 * the shell shows the not-found view if the role is gone. A 404 that only means one workspace was
 * deleted changes nothing: the role is still there.
 */
export function useAdminAccessCheck(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const recheck = (key: QueryKey | undefined, error: Error | null) => {
      if (
        isAdminKey(key) &&
        error instanceof ApiClientError &&
        error.status === 404
      ) {
        void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      }
    };
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        recheck(event.query.queryKey, event.action.error);
      }
    });
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        recheck(event.mutation.options.mutationKey, event.action.error);
      }
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [queryClient]);
}

/** The Overview for a 7, 30 or 90-day period (the last period stays on screen while switching). */
export function useAdminOverview(days: number) {
  return useQuery({
    queryKey: [...ADMIN_QUERY_KEY, "overview", days],
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiRequest(`${ADMIN_API}/overview?days=${days}`, {
        schema: adminOverviewSchema,
      }),
  });
}

/** The workspaces list, 25 at a time, searched, filtered and sorted. */
export function useAdminWorkspaces(input: {
  q: string;
  filter: (typeof ADMIN_WORKSPACE_FILTERS)[number];
  sort: (typeof ADMIN_WORKSPACE_SORTS)[number];
}) {
  const q = input.q.trim();
  return usePagedList({
    queryKey: [...ADMIN_QUERY_KEY, "workspaces"],
    path: `${ADMIN_API}/workspaces`,
    params: {
      ...(q ? { q } : {}),
      filter: input.filter,
      sort: input.sort,
    },
    schema: adminWorkspacesPageSchema,
    limit: ADMIN_PAGE_SIZE,
  });
}

/** One workspace's facts. */
export function useAdminWorkspace(id: string) {
  return useQuery({
    queryKey: [...ADMIN_QUERY_KEY, "workspace", id],
    queryFn: () =>
      apiRequest(`${ADMIN_API}/workspaces/${encodeURIComponent(id)}`, {
        schema: adminWorkspaceSchema,
      }),
  });
}

/** "Not my group" reports, newest first, 25 at a time. */
export function useAdminReports() {
  return usePagedList({
    queryKey: [...ADMIN_QUERY_KEY, "reports"],
    path: `${ADMIN_API}/reports`,
    schema: adminReportsPageSchema,
    limit: ADMIN_PAGE_SIZE,
  });
}

/** The owner, the admins and the waiting invites. */
export function useAdminAdmins() {
  return useQuery({
    queryKey: [...ADMIN_QUERY_KEY, "admins"],
    queryFn: () =>
      apiRequest(`${ADMIN_API}/admins`, { schema: adminAdminsSchema }),
  });
}

/** The admin log, newest first, 25 at a time. */
export function useAdminLog(filter: (typeof ADMIN_LOG_FILTERS)[number]) {
  return usePagedList({
    queryKey: [...ADMIN_QUERY_KEY, "log"],
    path: `${ADMIN_API}/log`,
    params: { filter },
    schema: adminLogPageSchema,
    limit: ADMIN_PAGE_SIZE,
  });
}

/**
 * One admin write: the request, then every admin read refetches (the figures, the lists and the
 * log all move with it).
 */
function useAdminWrite<V, R>(
  request: (variables: V) => {
    path: string;
    method: "POST" | "DELETE";
    body?: object;
  },
  schema: z.ZodType<R>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ADMIN_QUERY_KEY,
    mutationFn: (variables: V) => {
      const { path, method, body } = request(variables);
      return apiRequest(`${ADMIN_API}${path}`, { method, body, schema });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ADMIN_QUERY_KEY }),
  });
}

/** Pauses one workspace's sending (confirmed in the UI first). */
export function useSuspendWorkspace(id: string) {
  return useAdminWrite<void, z.infer<typeof okSchema>>(
    () => ({
      path: `/workspaces/${encodeURIComponent(id)}/suspension`,
      method: "POST",
    }),
    okSchema,
  );
}

/** Lifts one workspace's suspension. */
export function useLiftSuspension(id: string) {
  return useAdminWrite<void, z.infer<typeof okSchema>>(
    () => ({
      path: `/workspaces/${encodeURIComponent(id)}/suspension`,
      method: "DELETE",
    }),
    okSchema,
  );
}

/** Marks one report reviewed. */
export function useMarkReviewed() {
  return useAdminWrite<string, z.infer<typeof okSchema>>(
    (reportId) => ({
      path: `/reports/${encodeURIComponent(reportId)}/reviewed`,
      method: "POST",
    }),
    okSchema,
  );
}

/** Invites one address to help run TapNShow, by email or as a link (platform owner). */
export function useInviteAdmin() {
  return useAdminWrite<
    { email: string; delivery: "email" | "link" },
    z.infer<typeof adminInviteResultSchema>
  >(
    (body) => ({ path: "/invites", method: "POST", body }),
    adminInviteResultSchema,
  );
}

/** A fresh link and 7 more days for a waiting invite, sent again or copied. */
export function useRenewAdminInvite() {
  return useAdminWrite<
    { id: string; delivery: "email" | "link" },
    z.infer<typeof adminInviteResultSchema>
  >(
    ({ id, delivery }) => ({
      path: `/invites/${encodeURIComponent(id)}/renew`,
      method: "POST",
      body: { delivery },
    }),
    adminInviteResultSchema,
  );
}

/** Revokes a waiting invite. */
export function useRevokeAdminInvite() {
  return useAdminWrite<string, z.infer<typeof okSchema>>(
    (id) => ({ path: `/invites/${encodeURIComponent(id)}`, method: "DELETE" }),
    okSchema,
  );
}

/** Removes an admin (never the owner). */
export function useRemoveAdmin() {
  return useAdminWrite<string, z.infer<typeof okSchema>>(
    (userId) => ({
      path: `/admins/${encodeURIComponent(userId)}`,
      method: "DELETE",
    }),
    okSchema,
  );
}

/** What an admin invite link shows the signed-in person (the token goes in the body). */
export function useAdminInvitePreview(token: string) {
  return useQuery({
    queryKey: [...ADMIN_QUERY_KEY, "invite-preview", token],
    queryFn: () =>
      apiRequest(`${ADMIN_API}/invites/preview`, {
        method: "POST",
        body: { token },
        schema: adminInvitePreviewSchema,
      }),
    retry: false,
  });
}

/** Accepts an admin invite for the signed-in, matching address. */
export function useAcceptAdminInvite() {
  return useAdminWrite<string, z.infer<typeof okSchema>>(
    (token) => ({ path: "/invites/accept", method: "POST", body: { token } }),
    okSchema,
  );
}
