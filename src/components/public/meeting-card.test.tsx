import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenInfoFixture } from "@/test/fixtures/tokens";
import { renderWithProviders } from "@/test/render";
import { MeetingCard } from "./meeting-card";

const meeting = tokenInfoFixture.meeting;

function browserZone(timeZone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    function (this: Intl.DateTimeFormat) {
      return { ...original.call(this), timeZone };
    },
  );
}

afterEach(() => vi.restoreAllMocks());

describe("MeetingCard", () => {
  it("folds the agenda and renders it safely when opened", () => {
    const { container } = renderWithProviders(
      <MeetingCard
        meeting={{
          ...meeting,
          agendaMd: "**Bring** a laptop <script>x</script>",
        }}
      />,
    );
    expect(screen.queryByText("Bring")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show agenda" }));
    expect(screen.getByText("Bring").tagName).toBe("STRONG");
    expect(screen.getByText(/<script>x<\/script>/)).toBeInTheDocument();
    expect(container.querySelector("#meeting-agenda script")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide agenda" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("has no agenda button without an agenda", () => {
    renderWithProviders(<MeetingCard meeting={meeting} />);
    expect(screen.queryByRole("button", { name: "Show agenda" })).toBeNull();
  });

  it("adds the member's own time when their zone differs (spec §7.10)", () => {
    browserZone("Europe/Paris");
    renderWithProviders(<MeetingCard meeting={meeting} />);
    expect(screen.getByText("Your time: Fri 9 Oct, 19:00")).toBeInTheDocument();
  });

  it("shows no second time in the meeting's own zone", () => {
    browserZone("Africa/Tunis");
    renderWithProviders(<MeetingCard meeting={meeting} />);
    expect(screen.queryByText(/Your time/)).toBeNull();
  });
});
