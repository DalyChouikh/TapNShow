import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { QueryProvider } from "@/components/providers/query-provider";
import { json, routeFetch } from "@/test/fetch";
import { tokenInfoFixture } from "@/test/fixtures/tokens";
import {
  useRequestCalendar,
  useSubmitAnswer,
  useTokenInfo,
} from "./use-token-page";

const TOKEN = "a".repeat(43);
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);
const ANSWER = {
  status: "late",
  delayMinutes: 20,
  reason: "Bus",
  comment: "",
  afterDeadline: false,
  respondedAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
};

describe("useSubmitAnswer", () => {
  it("PUTs the answer and shows it in the page's info at once", async () => {
    const fetchMock = routeFetch({
      [`GET /api/r/${TOKEN}`]: json(tokenInfoFixture),
      [`PUT /api/r/${TOKEN}/response`]: json(ANSWER),
    });
    const { result } = renderHook(
      () => ({ info: useTokenInfo(TOKEN), submit: useSubmitAnswer(TOKEN) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.info.data).toBeDefined());
    await act(() =>
      result.current.submit.mutateAsync({
        status: "late",
        delayMinutes: 20,
        reason: "Bus",
        comment: "",
      }),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      status: "late",
      delayMinutes: 20,
      reason: "Bus",
      comment: "",
    });
    await waitFor(() =>
      expect(result.current.info.data?.answer).toEqual(ANSWER),
    );
  });
});

describe("useRequestCalendar", () => {
  it("POSTs the request and marks it requested", async () => {
    routeFetch({
      [`GET /api/r/${TOKEN}`]: json(tokenInfoFixture),
      [`POST /api/r/${TOKEN}/calendar`]: json({ ok: true }),
    });
    const { result } = renderHook(
      () => ({ info: useTokenInfo(TOKEN), ask: useRequestCalendar(TOKEN) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.info.data).toBeDefined());
    await act(() => result.current.ask.mutateAsync());
    await waitFor(() =>
      expect(result.current.info.data?.calendarRequested).toBe(true),
    );
  });
});
