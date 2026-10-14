import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { QueryProvider } from "@/components/providers/query-provider";
import type { MyInvite } from "@/shared/api/my-invites";
import { json, routeFetch } from "@/test/fetch";
import { fetchMyInviteLink, useMyInvites } from "./use-my-invites";

const ID = "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);
const invite: MyInvite = {
  inviteeId: ID,
  workspaceName: "Robotics Club",
  title: "Weekly sync",
  startsAt: "2026-10-20T16:00:00.000Z",
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  status: "scheduled",
  responseMode: "attendance",
  responseDeadline: null,
  needsAnswer: true,
  answer: null,
  mark: null,
};

describe("useMyInvites", () => {
  it("asks for the tab and the chip, and exposes the count and the server time", async () => {
    const fetchMock = routeFetch({
      "GET /api/me/invites?tab=upcoming&filter=needs&limit=50": json({
        items: [invite],
        nextCursor: null,
        needsCount: 3,
        asOf: "2026-10-14T10:00:00.000Z",
      }),
    });
    const { result } = renderHook(() => useMyInvites("upcoming", "needs"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.items).toEqual([invite]));
    expect(result.current.needsCount).toBe(3);
    expect(result.current.asOf).toBe("2026-10-14T10:00:00.000Z");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("has no count and no time before the first page arrives", () => {
    routeFetch({
      "GET /api/me/invites?tab=past&filter=all&limit=50": () =>
        new Promise<Response>(() => undefined),
    });
    const { result } = renderHook(() => useMyInvites("past", "all"), {
      wrapper,
    });
    expect(result.current.needsCount).toBe(0);
    expect(result.current.asOf).toBeNull();
  });
});

describe("fetchMyInviteLink", () => {
  it("returns the answer page path", async () => {
    const path = `/r/${"a".repeat(43)}`;
    routeFetch({ [`GET /api/me/invites/${ID}/link`]: json({ path }) });
    expect(await fetchMyInviteLink(ID)).toBe(path);
  });
});
