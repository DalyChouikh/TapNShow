import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { membersFixture, ownerId, viewerId } from "@/test/fixtures/members";
import { renderWithProviders } from "@/test/render";
import { PeopleSection } from "./people-section";

afterEach(() => vi.unstubAllGlobals());
const membersUrl = "/api/workspaces/robotics-cd34/members";

describe("PeopleSection", () => {
  it("lists members and offers only the allowed actions", async () => {
    routeFetch({
      [`GET ${membersUrl}?limit=50`]: json({
        items: membersFixture,
        nextCursor: null,
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <PeopleSection workspace={workspaceFixture} myId={ownerId} />,
    );
    expect(await screen.findByText("Admin Person")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Actions for You" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Actions for Viewer Person" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Make Admin" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Allow check-in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Remove from workspace" }),
    ).toBeInTheDocument();
  });

  it("promotes through the API and refreshes", async () => {
    const fetchMock = routeFetch({
      [`GET ${membersUrl}?limit=50`]: json({
        items: membersFixture,
        nextCursor: null,
      }),
      [`PATCH ${membersUrl}/${viewerId}`]: json({ ok: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <PeopleSection workspace={workspaceFixture} myId={ownerId} />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Actions for Viewer Person" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Make Admin" }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "PATCH",
      );
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        role: "admin",
        canCheckIn: false,
      });
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).startsWith(`${membersUrl}?`),
        ),
      ).toHaveLength(2),
    );
  });
});
