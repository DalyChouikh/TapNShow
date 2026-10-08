"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PROGRESS_POLL_MS } from "@/config/meetings";
import { rosterQueryKey } from "@/hooks/use-roster";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import {
  type AddPeopleBody,
  addPeopleResponseSchema,
  type AudienceBody,
  audienceSchema,
  createMeetingResponseSchema,
  type Meeting,
  meetingListSchema,
  meetingSchema,
  previewSchema,
  progressSchema,
  sendResultSchema,
  type UpdateMeetingBody,
} from "@/shared/api/meetings";

const base = (slug: string) =>
  `/api/workspaces/${encodeURIComponent(slug)}/meetings`;

/** Query keys. */
export const meetingsQueryKey = (slug: string) => ["meetings", slug] as const;
export const meetingQueryKey = (slug: string, id: string) =>
  ["meeting", slug, id] as const;
export const audienceQueryKey = (slug: string, id: string) =>
  ["meeting-audience", slug, id] as const;
export const progressQueryKey = (slug: string, id: string) =>
  ["meeting-progress", slug, id] as const;
const previewQueryKey = (slug: string, id: string) =>
  ["meeting-preview", slug, id] as const;

/** All meetings (Meetings page). */
export function useMeetings(slug: string) {
  return useQuery({
    queryKey: meetingsQueryKey(slug),
    queryFn: () => apiRequest(base(slug), { schema: meetingListSchema }),
  });
}

/** One meeting. */
export function useMeeting(slug: string, id: string) {
  return useQuery({
    queryKey: meetingQueryKey(slug, id),
    queryFn: () => apiRequest(`${base(slug)}/${id}`, { schema: meetingSchema }),
  });
}

/** "+": creates a draft and returns its id. */
export function useCreateMeeting(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(base(slug), {
        method: "POST",
        body: {},
        schema: createMeetingResponseSchema,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: meetingsQueryKey(slug) }),
  });
}

/** Saves one step's fields optimistically; rolls back on failure. */
export function useUpdateMeeting(slug: string, id: string) {
  const queryClient = useQueryClient();
  const key = meetingQueryKey(slug, id);
  return useMutation({
    mutationFn: (patch: UpdateMeetingBody) =>
      apiRequest(`${base(slug)}/${id}`, {
        method: "PATCH",
        body: patch,
        schema: meetingSchema,
      }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Meeting>(key);
      if (previous) {
        queryClient.setQueryData<Meeting>(key, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData<Meeting>(key, context.previous);
      }
    },
    onSuccess: (meeting) => queryClient.setQueryData<Meeting>(key, meeting),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: meetingsQueryKey(slug) });
      void queryClient.invalidateQueries({
        queryKey: previewQueryKey(slug, id),
      });
    },
  });
}

/** Deletes a draft. */
export function useDeleteMeeting(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest(`${base(slug)}/${id}`, { method: "DELETE", schema: okSchema }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: meetingsQueryKey(slug) }),
  });
}

/** The resolved audience. */
export function useMeetingAudience(slug: string, id: string) {
  return useQuery({
    queryKey: audienceQueryKey(slug, id),
    queryFn: () =>
      apiRequest(`${base(slug)}/${id}/audience`, { schema: audienceSchema }),
  });
}

/** Replaces lists / include / exclude; the response is the new audience. */
export function useSetAudience(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AudienceBody) =>
      apiRequest(`${base(slug)}/${id}/audience`, {
        method: "PUT",
        body,
        schema: audienceSchema,
      }),
    onSuccess: (audience) => {
      queryClient.setQueryData(audienceQueryKey(slug, id), audience);
      void queryClient.invalidateQueries({
        queryKey: previewQueryKey(slug, id),
      });
    },
  });
}

/** "Add people" (several at once). */
export function useAddPeople(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddPeopleBody) =>
      apiRequest(`${base(slug)}/${id}/people`, {
        method: "POST",
        body,
        schema: addPeopleResponseSchema,
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: audienceQueryKey(slug, id),
      });
      void queryClient.invalidateQueries({ queryKey: rosterQueryKey(slug) });
    },
  });
}

/** The invite preview (Review step). */
export function useMeetingPreview(slug: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: previewQueryKey(slug, id),
    queryFn: () =>
      apiRequest(`${base(slug)}/${id}/preview`, { schema: previewSchema }),
    enabled,
  });
}

/** Send (or Invite more). */
export function useSendMeeting(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`${base(slug)}/${id}/send`, {
        method: "POST",
        body: {},
        schema: sendResultSchema,
      }),
    onSettled: () => {
      for (const key of [
        meetingQueryKey(slug, id),
        audienceQueryKey(slug, id),
        progressQueryKey(slug, id),
        meetingsQueryKey(slug),
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** Live progress; polls every 3 s while anything is queued (spec §7.2). */
export function useMeetingProgress(slug: string, id: string, enabled = true) {
  return useQuery({
    queryKey: progressQueryKey(slug, id),
    queryFn: () =>
      apiRequest(`${base(slug)}/${id}/progress`, { schema: progressSchema }),
    enabled,
    refetchInterval: (query) =>
      (query.state.data?.counts.queued ?? 0) > 0 ? PROGRESS_POLL_MS : false,
  });
}
