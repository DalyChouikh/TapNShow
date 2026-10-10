"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meetingQueryKey, meetingsQueryKey } from "@/hooks/use-meetings";
import { meetingPeopleKey, meetingResultsKey } from "@/hooks/use-results";
import { apiRequest } from "@/lib/api-client";
import {
  cancelResultSchema,
  type EditFields,
  editResultSchema,
  nudgeResultSchema,
} from "@/shared/api/meetings";

const base = (slug: string, id: string) =>
  `/api/workspaces/${encodeURIComponent(slug)}/meetings/${id}`;

/** Key of an edit preview (the fields and the "email everyone" switch are part of it). */
export const editPreviewKey = (
  slug: string,
  id: string,
  fields: EditFields,
  notify: boolean,
) => ["meeting-edit-preview", slug, id, fields, notify] as const;

/** What saving these changes would change and who it would email (writes nothing). */
export function useEditPreview(
  slug: string,
  id: string,
  fields: EditFields,
  notify: boolean,
  enabled: boolean,
) {
  return useQuery({
    queryKey: editPreviewKey(slug, id, fields, notify),
    queryFn: () =>
      apiRequest(`${base(slug, id)}/changes`, {
        method: "POST",
        body: { fields, notify, dryRun: true },
        schema: editResultSchema,
      }),
    enabled,
    staleTime: 0,
  });
}

/** Refreshes everything a change of a sent meeting can move: it, its counts, people, the list. */
function useRefreshMeeting(slug: string, id: string) {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [
      meetingQueryKey(slug, id),
      meetingResultsKey(slug, id),
      meetingPeopleKey(slug, id),
      meetingsQueryKey(slug),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

/** Saves an edit of a sent meeting (spec §7.5). */
export function useSaveEdit(slug: string, id: string) {
  const refresh = useRefreshMeeting(slug, id);
  return useMutation({
    mutationFn: (input: { fields: EditFields; notify: boolean }) =>
      apiRequest(`${base(slug, id)}/changes`, {
        method: "POST",
        body: { ...input, dryRun: false },
        schema: editResultSchema,
      }),
    onSuccess: refresh,
  });
}

/** Cancels a sent meeting (spec §7.5). */
export function useCancelMeeting(slug: string, id: string) {
  const refresh = useRefreshMeeting(slug, id);
  return useMutation({
    mutationFn: () =>
      apiRequest(`${base(slug, id)}/cancel`, {
        method: "POST",
        body: {},
        schema: cancelResultSchema,
      }),
    onSuccess: refresh,
  });
}

/** Reminds everyone who hasn't answered (spec §7.6 Nudge). */
export function useNudgeMeeting(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`${base(slug, id)}/nudge`, {
        method: "POST",
        body: {},
        schema: nudgeResultSchema,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: meetingResultsKey(slug, id) }),
  });
}
