import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { InvitesPanel } from "./invites-panel";

const invitesUrl = "/api/workspaces/robotics-cd34/invites";
const pending = {
  id: "7c1e4b2a-9d3f-4e6a-8b5c-0f1a2b3c4d5e",
  email: "v@example.test",
  role: "viewer",
  status: "pending",
  expiresAt: "2026-10-12T10:00:00Z",
  createdAt: "2026-10-05T10:00:00Z",
};
const expired = {
  ...pending,
  id: "8d2f5c3b-0e4a-4f7b-9c6d-1a2b3c4d5e6f",
  email: "old@example.test",
  status: "expired",
  expiresAt: "2026-09-30T10:00:00Z",
};
afterEach(() => vi.unstubAllGlobals());

describe("InvitesPanel", () => {
  it("lists open invites with status and expiry", async () => {
    routeFetch({ [`GET ${invitesUrl}`]: json([pending, expired]) });
    renderWithProviders(<InvitesPanel workspace={workspaceFixture} />);
    expect(await screen.findByText("v@example.test")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText(/^Expires Oct 12, 2026$/)).toBeInTheDocument();
  });

  it("Copy link renews the invite and copies the new link", async () => {
    routeFetch({
      [`GET ${invitesUrl}`]: json([pending]),
      [`POST ${invitesUrl}/${pending.id}/renew`]: json(
        {
          id: pending.id,
          delivery: "link",
          link: "http://localhost:3000/invite/new",
        },
        201,
      ),
    });
    const user = userEvent.setup();
    renderWithProviders(<InvitesPanel workspace={workspaceFixture} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Invite actions for v@example.test",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe(
        "http://localhost:3000/invite/new",
      ),
    );
  });

  it("Cancel invite sends DELETE", async () => {
    const fetchMock = routeFetch({
      [`GET ${invitesUrl}`]: json([pending]),
      [`DELETE ${invitesUrl}/${pending.id}`]: json({ ok: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(<InvitesPanel workspace={workspaceFixture} />);
    await user.click(
      await screen.findByRole("button", {
        name: "Invite actions for v@example.test",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Cancel invite" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
      ).toBe(true),
    );
  });

  it("renders nothing for Viewers", () => {
    renderWithProviders(
      <InvitesPanel workspace={{ ...workspaceFixture, myRole: "viewer" }} />,
    );
    expect(screen.queryByRole("heading", { name: "Invites" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Invite someone/ })).toBeNull();
  });
});
