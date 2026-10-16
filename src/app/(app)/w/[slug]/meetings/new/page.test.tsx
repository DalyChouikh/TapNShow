import { waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import NewMeetingPage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "robotics-cd34" }),
  useRouter: () => ({ replace }),
}));

describe("/w/[slug]/meetings/new", () => {
  it("creates one draft and opens the wizard on it, even in Strict Mode", async () => {
    const fetchMock = routeFetch({
      "POST /api/workspaces/robotics-cd34/meetings": json({
        id: MEETING_IDS.meeting,
      }),
      "GET /api/workspaces/robotics-cd34/meetings": json([]),
    });
    renderWithProviders(
      <StrictMode>
        <NewMeetingPage />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        `/w/robotics-cd34/meetings/${MEETING_IDS.meeting}/edit?step=details`,
      ),
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
});
