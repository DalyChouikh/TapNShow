import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meetingFixture } from "@/test/fixtures/meetings";
import { useEditDraft } from "./use-edit-draft";

const sent = { ...meetingFixture, status: "scheduled" as const };
const key = `tn:edit:${sent.id}`;

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("useEditDraft", () => {
  it("keeps what differs, in the tab's storage", () => {
    const { result } = renderHook(() => useEditDraft(sent));
    act(() => result.current.save({ title: "New" }));
    expect(result.current.fields).toEqual({ title: "New" });
    expect(result.current.view.title).toBe("New");
    expect(JSON.parse(sessionStorage.getItem(key) ?? "null")).toEqual({
      title: "New",
    });
    act(() => result.current.save({ title: sent.title }));
    expect(result.current.fields).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("treats the same instant written differently as no change", () => {
    const { result } = renderHook(() => useEditDraft(sent));
    act(() => result.current.save({ startsAt: "2026-10-09T17:00:00+00:00" }));
    expect(result.current.fields).toBeNull();
  });

  it("drops the answer type and the delays, which are fixed once sent", () => {
    const { result } = renderHook(() => useEditDraft(sent));
    act(() =>
      result.current.save({
        responseMode: "rsvp",
        delayOptions: [5],
        reasonRequired: false,
      }),
    );
    expect(result.current.fields).toEqual({ reasonRequired: false });
  });

  it("reads a stored draft back, and clear removes it", () => {
    const first = renderHook(() => useEditDraft(sent));
    act(() => first.result.current.save({ locationText: "Hall A" }));
    const second = renderHook(() => useEditDraft(sent));
    expect(second.result.current.fields).toEqual({ locationText: "Hall A" });
    act(() => second.result.current.clear());
    expect(second.result.current.fields).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("still works in memory when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useEditDraft(sent));
    act(() => result.current.save({ title: "New" }));
    expect(result.current.fields).toEqual({ title: "New" });
  });
});
