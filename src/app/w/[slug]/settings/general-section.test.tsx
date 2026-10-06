import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { GeneralSection } from "./general-section";

vi.mock("@/lib/timezones", () => ({
  listTimezones: () => ["Africa/Tunis", "Europe/Paris"],
  browserTimezone: () => "Africa/Tunis",
}));
afterEach(() => vi.unstubAllGlobals());

describe("GeneralSection", () => {
  it("lets Owners/Admins rename", async () => {
    const fetchMock = routeFetch({
      "PATCH /api/workspaces/robotics-cd34": json({ ok: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(<GeneralSection workspace={workspaceFixture} />);
    const name = screen.getByLabelText("Workspace name");
    await user.clear(name);
    await user.type(name, "Robotics & AI");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
        name: "Robotics & AI",
        timezone: "Africa/Tunis",
      }),
    );
  });

  it("is read-only for Viewers", () => {
    renderWithProviders(
      <GeneralSection workspace={{ ...workspaceFixture, myRole: "viewer" }} />,
    );
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(
      screen.getByText("Only Owners and Admins can change these."),
    ).toBeInTheDocument();
    expect(screen.getByText("Africa/Tunis")).toBeInTheDocument();
  });
});
