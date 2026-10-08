import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resultsFixture } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { SendProgress } from "./send-progress";

const props = { slug: "club-ab12", canConnect: false };

describe("SendProgress", () => {
  it("shows live sending with the done count", () => {
    renderWithProviders(<SendProgress {...props} results={resultsFixture} />);
    expect(screen.getByText("Sending 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("You can leave this page.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
  });

  it("explains a quota wait, a pause and the finished state", () => {
    const first = renderWithProviders(
      <SendProgress
        {...props}
        results={{ ...resultsFixture, resumesAt: "2026-10-08T13:20:00.000Z" }}
      />,
    );
    expect(
      screen.getByText(/1 queued, resumes about \d{2}:\d{2}/),
    ).toBeInTheDocument();
    first.unmount();
    const second = renderWithProviders(
      <SendProgress
        {...props}
        results={{ ...resultsFixture, paused: 1, senderState: "missing" }}
      />,
    );
    expect(
      screen.getByText("Paused: connect Gmail to send."),
    ).toBeInTheDocument();
    second.unmount();
    renderWithProviders(
      <SendProgress
        {...props}
        results={{
          ...resultsFixture,
          emails: { ...resultsFixture.emails, queued: 0, sent: 1, failed: 1 },
        }}
      />,
    );
    expect(
      screen.getByText("1 sent · 1 failed · 0 unknown"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "If an address doesn't exist, Gmail will tell you in your inbox.",
      ),
    ).toBeInTheDocument();
  });
});
