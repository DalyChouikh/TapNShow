import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { InviteDialog } from "./invite-dialog";

const invitesUrl = "/api/workspaces/robotics-cd34/invites";
const id = (n: number) => `7c1e4b2a-9d3f-4e6a-8b5c-0f1a2b3c4d5${n}`;
afterEach(() => vi.unstubAllGlobals());

describe("InviteDialog", () => {
  it("only the Owner can choose Admin", () => {
    renderWithProviders(
      <InviteDialog
        open
        onOpenChange={() => {}}
        workspace={{ ...workspaceFixture, myRole: "admin" }}
      />,
    );
    expect(screen.queryByRole("radio", { name: /^Admin:/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /^Viewer:/ })).toBeChecked();
  });

  it("invites several people by link and copies every link at once", async () => {
    const fetchMock = routeFetch({
      [`POST ${invitesUrl}`]: json({
        results: [
          {
            email: "a@x.test",
            status: "link",
            inviteId: id(0),
            link: "http://localhost:3000/invite/aaa",
          },
          {
            email: "b@x.test",
            status: "link",
            inviteId: id(1),
            link: "http://localhost:3000/invite/bbb",
          },
          { email: "in@x.test", status: "already_member" },
        ],
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <InviteDialog
        open
        onOpenChange={() => {}}
        workspace={workspaceFixture}
      />,
    );
    await user.type(
      screen.getByLabelText("Email addresses"),
      "a@x.test, b@x.test in@x.test{Enter}",
    );
    await user.click(
      screen.getByRole("radio", { name: "Give me a link to share" }),
    );
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("a@x.test"),
      expect.stringContaining("b@x.test"),
      expect.stringContaining("Already in the workspace"),
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      emails: ["a@x.test", "b@x.test", "in@x.test"],
      role: "viewer",
      delivery: "link",
    });
    await user.click(screen.getByRole("button", { name: "Copy all links" }));
    expect(await navigator.clipboard.readText()).toBe(
      "a@x.test: http://localhost:3000/invite/aaa\nb@x.test: http://localhost:3000/invite/bbb",
    );
    await user.click(
      within(rows[1]).getByRole("button", { name: "Copy link for b@x.test" }),
    );
    expect(await navigator.clipboard.readText()).toBe(
      "http://localhost:3000/invite/bbb",
    );
  });

  it("shows per-person email results and turns a failed one into a link", async () => {
    routeFetch({
      [`POST ${invitesUrl}`]: json({
        results: [
          { email: "a@x.test", status: "sent", inviteId: id(0) },
          { email: "b@x.test", status: "email_limit", inviteId: id(1) },
        ],
      }),
      [`POST ${invitesUrl}/${id(1)}/renew`]: json(
        {
          id: id(1),
          delivery: "link",
          link: "http://localhost:3000/invite/new",
        },
        201,
      ),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <InviteDialog
        open
        onOpenChange={() => {}}
        workspace={workspaceFixture}
      />,
    );
    await user.type(
      screen.getByLabelText("Email addresses"),
      "a@x.test b@x.test{Enter}",
    );
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(await screen.findByText("Email sent")).toBeInTheDocument();
    expect(screen.getByText("Email limit reached")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Copy link for b@x.test" }),
    );
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe(
        "http://localhost:3000/invite/new",
      ),
    );
  });

  it("explains invalid or missing addresses before sending", async () => {
    const fetchMock = routeFetch({});
    const user = userEvent.setup();
    renderWithProviders(
      <InviteDialog
        open
        onOpenChange={() => {}}
        workspace={workspaceFixture}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(
      await screen.findByText("Add at least one email address."),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email addresses"), "nope{Enter}");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(
      await screen.findByText("Fix or remove the highlighted addresses."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
