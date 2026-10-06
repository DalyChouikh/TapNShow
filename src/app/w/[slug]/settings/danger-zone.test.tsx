import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { adminId, membersFixture, ownerId } from "@/test/fixtures/members";
import { renderWithProviders } from "@/test/render";
import { DangerZone } from "./danger-zone";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
});

describe("DangerZone", () => {
  it("shows Transfer and Delete to the Owner, Leave to everyone else", () => {
    const { unmount } = renderWithProviders(
      <DangerZone
        workspace={workspaceFixture}
        myId={ownerId}
        members={membersFixture}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Transfer ownership" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Leave workspace" }),
    ).toBeNull();
    unmount();
    renderWithProviders(
      <DangerZone
        workspace={{ ...workspaceFixture, myRole: "admin" }}
        myId={adminId}
        members={membersFixture}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Leave workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete workspace" }),
    ).toBeNull();
  });

  it("deletes after the exact name and goes to /welcome", async () => {
    const fetchMock = routeFetch({
      "DELETE /api/workspaces/robotics-cd34": json({ ok: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <DangerZone
        workspace={workspaceFixture}
        myId={ownerId}
        members={membersFixture}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete workspace" }));
    await user.type(
      screen.getByLabelText("Type Robotics Club to confirm"),
      "Robotics Club",
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/welcome"));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      confirmName: "Robotics Club",
    });
  });

  it("transfers only to an Admin and explains when there is none", async () => {
    const fetchMock = routeFetch({
      "POST /api/workspaces/robotics-cd34/transfer": json({ ok: true }),
    });
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <DangerZone
        workspace={workspaceFixture}
        myId={ownerId}
        members={membersFixture}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Transfer ownership" }),
    );
    const select = screen.getByRole("combobox", { name: "New Owner" });
    expect(
      Array.from((select as HTMLSelectElement).options).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Choose an Admin", "Admin Person"]);
    await user.selectOptions(select, adminId);
    await user.type(
      screen.getByLabelText("Type Robotics Club to confirm"),
      "Robotics Club",
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
        userId: adminId,
        confirmName: "Robotics Club",
      }),
    );
    unmount();
    renderWithProviders(
      <DangerZone
        workspace={workspaceFixture}
        myId={ownerId}
        members={membersFixture.filter((member) => member.role !== "admin")}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Transfer ownership" }),
    );
    expect(
      screen.getByText("Make someone an Admin first."),
    ).toBeInTheDocument();
  });
});
