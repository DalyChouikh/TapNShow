import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { QueryProvider } from "@/components/providers/query-provider";
import { toggleList } from "@/lib/meetings/audience-edit";
import { routeFetch } from "@/test/fetch";
import { audienceFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import {
  useAddPeople,
  useMeetingAudience,
  useSetAudience,
} from "./use-meetings";

const GUEST = "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6bb";
const base = `/api/workspaces/club-ab12/meetings/${MEETING_IDS.meeting}`;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);

describe("audience edits after Add people", () => {
  it("a list tap right after Add people keeps the people just added", async () => {
    let current = { ...audienceFixture };
    const guest = {
      id: GUEST,
      fullName: "Nour H.",
      email: "nour@uni.tn",
      listIds: [],
      added: true,
      excluded: false,
      unsubscribed: false,
      reported: false,
      invited: false,
    };
    const fetchMock = routeFetch({
      [`GET ${base}/audience`]: () => new Response(JSON.stringify(current)),
      [`POST ${base}/people`]: () => {
        current = { ...current, people: [...current.people, guest] };
        return new Response(JSON.stringify({ contactIds: [GUEST] }));
      },
      [`PUT ${base}/audience`]: (init) => {
        const body = JSON.parse(String(init?.body));
        current = { ...current, listIds: body.listIds };
        return new Response(JSON.stringify(current));
      },
      "GET /api/workspaces/club-ab12/contacts": () => new Response("{}"),
    });
    const { result } = renderHook(
      () => ({
        audience: useMeetingAudience("club-ab12", MEETING_IDS.meeting),
        add: useAddPeople("club-ab12", MEETING_IDS.meeting),
        set: useSetAudience("club-ab12", MEETING_IDS.meeting),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.audience.data).toBeDefined());
    act(() => {
      result.current.add.mutate({
        people: [{ fullName: "Nour H.", email: "nour@uni.tn" }],
        saveToRoster: false,
      });
      result.current.set.mutate((audience) =>
        toggleList(audience, MEETING_IDS.committee),
      );
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
      ).toBe(true),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body)).include).toEqual([GUEST]);
  });
});
