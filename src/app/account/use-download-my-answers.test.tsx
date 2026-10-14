import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import type { ExportSheet } from "@/lib/export/save";
import type { MyAnswer } from "@/shared/api/my-invites";
import { useDownloadMyAnswers } from "./use-download-my-answers";

const mocks = vi.hoisted(() => ({
  fetchAllPages: vi.fn(),
  saveExport:
    vi.fn<
      (
        format: string,
        sheets: ExportSheet[],
        parts: string[],
        today: Date,
      ) => Promise<void>
    >(),
}));
vi.mock("@/lib/api/fetch-all-pages", () => ({
  fetchAllPages: mocks.fetchAllPages,
}));
vi.mock("@/lib/export/save", () => ({ saveExport: mocks.saveExport }));

const row: MyAnswer = {
  inviteeId: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
  workspaceName: "GDG ISSAT",
  title: "Kickoff",
  startsAt: "2026-10-11T17:00:00.000Z",
  timezone: "Africa/Tunis",
  responseMode: "attendance",
  status: "scheduled",
  answer: null,
  mark: null,
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);

beforeEach(() => vi.clearAllMocks());

describe("useDownloadMyAnswers", () => {
  it("saves one My answers sheet with the member columns, named my-answers", async () => {
    mocks.fetchAllPages.mockResolvedValueOnce([row]);
    const { result } = renderHook(
      () => useDownloadMyAnswers("amira@example.test"),
      { wrapper },
    );
    await result.current("xlsx");
    expect(mocks.fetchAllPages).toHaveBeenCalledWith(
      "/api/me/answers",
      {},
      expect.anything(),
    );
    const [format, sheets, parts] = mocks.saveExport.mock.calls[0];
    expect(format).toBe("xlsx");
    expect(parts).toEqual(["my-answers"]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("My answers");
    expect(sheets[0].columns.map((column) => column.header)).toEqual([
      "Group",
      "Meeting",
      "Date",
      "Answer",
      "Late by (min)",
      "Reason",
      "Comment",
      "Answered at",
      "After the deadline",
      "Checked in",
      "Was late by (min)",
    ]);
    expect(sheets[0].rows[0].slice(0, 4)).toEqual([
      "GDG ISSAT",
      "Kickoff",
      "2026-10-11 18:00",
      { text: "No reply", tone: "neutral" },
    ]);
  });
});
