import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { progressFixture } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { SendProgress } from "./send-progress";

const props = { slug: "club-ab12", canConnect: false };

describe("SendProgress", () => {
  it("shows live sending with the done count", () => {
    renderWithProviders(<SendProgress {...props} progress={progressFixture} />);
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
        progress={{ ...progressFixture, resumesAt: "2026-10-08T13:20:00.000Z" }}
      />,
    );
    expect(
      screen.getByText(/1 queued, resumes about \d{2}:\d{2}/),
    ).toBeInTheDocument();
    first.unmount();
    const second = renderWithProviders(
      <SendProgress
        {...props}
        progress={{ ...progressFixture, paused: 1, senderState: "missing" }}
      />,
    );
    expect(
      screen.getByText("Paused: connect Gmail to send."),
    ).toBeInTheDocument();
    second.unmount();
    renderWithProviders(
      <SendProgress
        {...props}
        progress={{
          ...progressFixture,
          counts: { ...progressFixture.counts, queued: 0, sent: 1, failed: 1 },
        }}
      />,
    );
    expect(
      screen.getByText("1 sent · 1 failed · 0 unknown"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bounce notices arrive in the sender's Gmail; TapNShow can't read them.",
      ),
    ).toBeInTheDocument();
  });
});
