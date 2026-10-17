import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { QueryProvider } from "@/components/providers/query-provider";
import type { PeriodRange } from "@/shared/api/responses";
import { json, routeFetch } from "@/test/fetch";
import { insightsFixture } from "@/test/fixtures/insights";
import { senderFixture } from "@/test/fixtures/sender";
import { sheetFixture } from "@/test/fixtures/sheet";
import { useHomeSetup } from "./use-home-setup";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);
const base = "/api/workspaces/club-ab12";
const ALL_TIME: PeriodRange = { from: null, to: null };

function serve(options: {
  members: number;
  committee: number;
  sender: boolean | "broken";
  sheet: "off" | "on";
  held?: number;
}) {
  const sender = senderFixture(options.sender !== false);
  return routeFetch({
    [`GET ${base}/insights`]: json({
      ...insightsFixture,
      roster: {
        members: options.members,
        lists: 0,
        committee: options.committee,
      },
      held: options.held ?? 0,
    }),
    [`GET ${base}/sender`]: json(
      options.sender === "broken" && sender.sender
        ? { ...sender, sender: { ...sender.sender, status: "broken" } }
        : sender,
    ),
    [`GET ${base}/sheet`]: json(sheetFixture(options.sheet)),
  });
}

describe("useHomeSetup", () => {
  it("marks each step done from the roster, committee, sender and sheet", async () => {
    serve({ members: 0, committee: 2, sender: false, sheet: "on" });
    const { result } = renderHook(() => useHomeSetup("club-ab12", ALL_TIME), {
      wrapper,
    });
    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current).toEqual({
      state: "ready",
      done: {
        importMembers: false,
        connectGmail: false,
        inviteCommittee: true,
        connectSheets: true,
      },
      complete: false,
      ownerName: "Daly",
    });
  });

  it("is complete once members and Gmail are done, whatever the optional steps", async () => {
    serve({ members: 30, committee: 0, sender: true, sheet: "off" });
    const { result } = renderHook(() => useHomeSetup("club-ab12", ALL_TIME), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current).toMatchObject({ state: "ready", complete: true }),
    );
  });

  it("counts a Gmail that needs reconnecting as connected (Needs attention asks for that)", async () => {
    serve({ members: 30, committee: 1, sender: "broken", sheet: "off" });
    const { result } = renderHook(() => useHomeSetup("club-ab12", ALL_TIME), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current).toMatchObject({
        state: "ready",
        done: { connectGmail: true },
        complete: true,
      }),
    );
  });

  it("stays set up once a meeting has counted, even with Gmail disconnected later", async () => {
    serve({ members: 30, committee: 1, sender: false, sheet: "off", held: 40 });
    const { result } = renderHook(() => useHomeSetup("club-ab12", ALL_TIME), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current).toMatchObject({
        state: "ready",
        done: { connectGmail: false },
        complete: true,
      }),
    );
  });

  it("reports a failed load and tries the failed part again", async () => {
    let senderCalls = 0;
    routeFetch({
      [`GET ${base}/insights`]: json(insightsFixture),
      [`GET ${base}/sheet`]: json(sheetFixture()),
      [`GET ${base}/sender`]: () => {
        senderCalls += 1;
        return senderCalls === 1
          ? new Response(JSON.stringify({ error: { code: "forbidden" } }), {
              status: 403,
            })
          : new Response(JSON.stringify(senderFixture()));
      },
    });
    const { result } = renderHook(() => useHomeSetup("club-ab12", ALL_TIME), {
      wrapper,
    });
    await waitFor(() => expect(result.current.state).toBe("error"));
    const failed = result.current;
    act(() => {
      if (failed.state === "error") {
        failed.retry();
      }
    });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(senderCalls).toBe(2);
  });
});
