import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Answer } from "@/shared/api/responses";
import { tokenInfoFixture } from "@/test/fixtures/tokens";
import { renderWithProviders } from "@/test/render";
import { ReconfirmBanner } from "./reconfirm-banner";

const answer: Answer = {
  status: "attending",
  delayMinutes: null,
  reason: "",
  comment: "",
  afterDeadline: false,
  respondedAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
  needsReconfirmation: true,
};

function banner(previousStartsAt: string | null) {
  renderWithProviders(
    <ReconfirmBanner
      meeting={{
        ...tokenInfoFixture.meeting,
        startsAt: "2026-10-09T17:00:00.000Z",
        previousStartsAt,
      }}
      answer={answer}
      pending={false}
      errorText={null}
      onConfirm={vi.fn()}
      onChange={vi.fn()}
    />,
  );
}

describe("ReconfirmBanner", () => {
  it("names the new time when the time moved", () => {
    banner("2026-10-09T16:00:00.000Z");
    expect(screen.getByText(/^The time changed to /)).toBeInTheDocument();
  });

  it("only asks to confirm again when the time moved back (#255)", () => {
    banner(null);
    expect(
      screen.getByText("Please confirm your answer again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/The time changed/)).toBeNull();
  });
});
