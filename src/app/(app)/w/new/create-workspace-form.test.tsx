import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { CreateWorkspaceForm } from "./create-workspace-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/timezones", () => ({
  browserTimezone: () => "Africa/Tunis",
  listTimezones: () => ["Africa/Tunis", "Europe/Paris"],
}));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("CreateWorkspaceForm", () => {
  it("pre-fills the browser timezone, creates, and opens the new workspace", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ slug: "robotics-club-ab12" }), {
          status: 201,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<CreateWorkspaceForm />);
    expect(
      screen.getByRole("combobox", { name: "Timezone" }),
    ).toHaveTextContent("Africa/Tunis");
    await user.type(screen.getByLabelText("Workspace name"), "Robotics Club");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/w/robotics-club-ab12"),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      name: "Robotics Club",
      timezone: "Africa/Tunis",
    });
  });

  it("explains the owned-workspace limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "workspace_limit" } }), {
            status: 409,
          }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<CreateWorkspaceForm />);
    await user.type(screen.getByLabelText("Workspace name"), "Eleventh");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(
      await screen.findByText(
        "You already own the maximum number of workspaces.",
      ),
    ).toBeInTheDocument();
  });
});
