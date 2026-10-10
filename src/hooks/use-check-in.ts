"use client";

import {
  type InfiniteData,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import { meetingPeopleKey, meetingResultsKey } from "@/hooks/use-results";
import { apiRequest } from "@/lib/api-client";
import type { Page } from "@/shared/api/pagination";
import {
  type Mark,
  markRestResultSchema,
  markResultSchema,
  type PersonRow,
} from "@/shared/api/responses";

type MarkInput = { inviteeId: string; actual: Mark["actual"] | null };
type PeoplePages = InfiniteData<Page<PersonRow>>;

/** Check one person in (spec §7.8): shown at once, sent one request at a time per person. */
export function useMarkAttendance(slug: string, id: string) {
  const queryClient = useQueryClient();
  const chains = useRef(new Map<string, Promise<void>>());
  const setMark = (inviteeId: string, mark: Mark | null) =>
    queryClient.setQueriesData<PeoplePages>(
      { queryKey: meetingPeopleKey(slug, id) },
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((person) =>
              person.inviteeId === inviteeId ? { ...person, mark } : person,
            ),
          })),
        },
    );
  return useMutation({
    mutationFn: (input: MarkInput) => {
      const previous = chains.current.get(input.inviteeId) ?? Promise.resolve();
      const request = previous.then(() =>
        apiRequest(
          `/api/workspaces/${encodeURIComponent(slug)}/meetings/${id}/check-in`,
          {
            method: "PUT",
            body: input,
            schema: markResultSchema,
          },
        ),
      );
      chains.current.set(
        input.inviteeId,
        request.then(
          () => undefined,
          () => undefined,
        ),
      );
      return request;
    },
    onMutate: (input) => {
      const before = queryClient.getQueriesData<PeoplePages>({
        queryKey: meetingPeopleKey(slug, id),
      });
      setMark(
        input.inviteeId,
        input.actual
          ? {
              actual: input.actual,
              markedAt: new Date().toISOString(),
              markedByName: null,
            }
          : null,
      );
      return { before };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.before ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSuccess: (result, input) => {
      setMark(input.inviteeId, result.mark);
      void queryClient.invalidateQueries({
        queryKey: meetingResultsKey(slug, id),
      });
    },
  });
}

/** "Mark the rest as they said" (spec §7.8). */
export function useMarkRest(slug: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(
        `/api/workspaces/${encodeURIComponent(slug)}/meetings/${id}/check-in/rest`,
        {
          method: "POST",
          body: {},
          schema: markRestResultSchema,
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: meetingPeopleKey(slug, id),
      });
      void queryClient.invalidateQueries({
        queryKey: meetingResultsKey(slug, id),
      });
    },
  });
}
