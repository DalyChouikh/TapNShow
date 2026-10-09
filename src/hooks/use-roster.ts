"use client";

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { addList, patchContact } from "@/lib/roster/roster-cache";
import { okSchema } from "@/shared/api/common";
import {
  bulkResultSchema,
  importResultSchema,
  listCreatedSchema,
  rosterSchema,
  type BulkContactsBody,
  type ImportBody,
  type Roster,
  type UpdateContactBody,
} from "@/shared/api/roster";

/** Query key of a workspace's roster. */
export const rosterQueryKey = (slug: string) => ["roster", slug] as const;

/** Base path of the roster API for `/w/[slug]`. */
export const rosterPath = (slug: string): string =>
  `/api/workspaces/${encodeURIComponent(slug)}`;

/** Query options of the whole roster, for `useQuery` and one-off reads (exports). */
export const rosterQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: rosterQueryKey(slug),
    queryFn: () =>
      apiRequest(`${rosterPath(slug)}/contacts`, { schema: rosterSchema }),
  });

/** The whole roster (`GET …/contacts`). */
export function useRoster(slug: string) {
  return useQuery(rosterQueryOptions(slug));
}

/**
 * Edits one person with an optimistic cache update; rolls back on failure and refetches after.
 * The caller shows the error (e.g. `contact_email_taken` next to the field).
 */
export function useUpdateContact(slug: string) {
  const queryClient = useQueryClient();
  const key = rosterQueryKey(slug);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateContactBody }) =>
      apiRequest(`${rosterPath(slug)}/contacts/${id}`, {
        method: "PATCH",
        body: patch,
        schema: okSchema,
      }),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Roster>(key);
      if (previous) {
        queryClient.setQueryData<Roster>(
          key,
          patchContact(previous, id, patch),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData<Roster>(key, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Deletes one person (the page hides them first and calls this when Undo expires). */
export function useDeleteContact(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`${rosterPath(slug)}/contacts/${id}`, {
        method: "DELETE",
        schema: okSchema,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) }),
  });
}

/** Select-mode actions. */
export function useBulkContacts(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkContactsBody) =>
      apiRequest(`${rosterPath(slug)}/contacts/bulk`, {
        method: "POST",
        body,
        schema: bulkResultSchema,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) }),
  });
}

/** Creates a list; it appears in the cache at once so a picker can select it. */
export function useCreateList(slug: string) {
  const queryClient = useQueryClient();
  const key = rosterQueryKey(slug);
  return useMutation({
    mutationFn: (name: string) =>
      apiRequest(`${rosterPath(slug)}/lists`, {
        method: "POST",
        body: { name },
        schema: listCreatedSchema,
      }),
    onSuccess: (list) => {
      const previous = queryClient.getQueryData<Roster>(key);
      if (previous) {
        queryClient.setQueryData<Roster>(key, addList(previous, list));
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Renames a list. */
export function useRenameList(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest(`${rosterPath(slug)}/lists/${id}`, {
        method: "PATCH",
        body: { name },
        schema: okSchema,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) }),
  });
}

/** Deletes a list (people stay). */
export function useDeleteList(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`${rosterPath(slug)}/lists/${id}`, {
        method: "DELETE",
        schema: okSchema,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) }),
  });
}

/** Import preview or commit; a commit refreshes the roster. */
export function useImportContacts(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportBody) =>
      apiRequest(`${rosterPath(slug)}/contacts/import`, {
        method: "POST",
        body,
        schema: importResultSchema,
      }),
    onSuccess: async (_result, body) => {
      if (!body.dryRun) {
        await queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) });
      }
    },
  });
}
