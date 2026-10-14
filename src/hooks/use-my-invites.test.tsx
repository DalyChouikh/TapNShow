import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { QueryProvider } from "@/components/providers/query-provider";
import { json, routeFetch } from "@/test/fetch";
import { myInviteFixture, myInvitesPage } from "@/test/fixtures/my-invites";
import { fetchMyInviteLink, useMyInvites } from "./use-my-invites";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);
const invite = myInviteFixture;
const ID = invite.inviteeId;

describe("useMyInvites", () => {
  it("asks for the tab and the chip, and exposes the count and the server time", async () => {
    const fetchMock = routeFetch({
      "GET /api/me/invites?tab=upcoming&filter=needs&limit=50": json(
        myInvitesPage([invite], { needsCount: 3 }),
      ),
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
