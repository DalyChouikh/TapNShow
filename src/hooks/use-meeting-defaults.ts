"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import {
  meetingDefaultsSchema,
  type MeetingDefaults,
  type UpdateMeetingDefaultsBody,
} from "@/shared/api/meeting-settings";

/** Query key of a workspace's meeting defaults. */
export const meetingDefaultsQueryKey = (slug: string) =>
  ["meeting-defaults", slug] as const;

const path = (slug: string) =>
  `/api/workspaces/${encodeURIComponent(slug)}/meeting-defaults`;

/** Settings > Meeting defaults. */
export function useMeetingDefaults(slug: string) {
  return useQuery({
    queryKey: meetingDefaultsQueryKey(slug),
    queryFn: () => apiRequest(path(slug), { schema: meetingDefaultsSchema }),
  });
}

/** Saves one or more defaults optimistically; rolls back on failure. */
export function useUpdateMeetingDefaults(slug: string) {
  const queryClient = useQueryClient();
  const key = meetingDefaultsQueryKey(slug);
  return useMutation({
    mutationFn: (patch: UpdateMeetingDefaultsBody) =>
      apiRequest(path(slug), {
        method: "PATCH",
        body: patch,
        schema: okSchema,
      }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MeetingDefaults>(key);
      if (previous) {
        queryClient.setQueryData<MeetingDefaults>(key, {
          ...previous,
          ...patch,
        });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData<MeetingDefaults>(key, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
