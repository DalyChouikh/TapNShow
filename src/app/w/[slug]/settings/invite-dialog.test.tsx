import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { InviteDialog } from "./invite-dialog";

const inviteId = "7c1e4b2a-9d3f-4e6a-8b5c-0f1a2b3c4d5e";
const invitesUrl = "/api/workspaces/robotics-cd34/invites";
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

  it("creates a link invite and shows the link to copy", async () => {
    routeFetch({
      [`POST ${invitesUrl}`]: json(
        {
          id: inviteId,
          delivery: "link",
          link: "http://localhost:3000/invite/tok",
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
    await user.type(screen.getByLabelText("Email address"), "new@example.test");
    await user.click(
      screen.getByRole("radio", { name: "Give me a link to share" }),
    );
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(await screen.findByLabelText("Invite link")).toHaveValue(
      "http://localhost:3000/invite/tok",
    );
  });

  it("offers Copy link instead when the email budget is used up", async () => {
    routeFetch({
      [`POST ${invitesUrl}`]: json(
        { error: { code: "invite_email_limit", details: { inviteId } } },
        429,
      ),
      [`POST ${invitesUrl}/${inviteId}/renew`]: json(
        {
          id: inviteId,
          delivery: "link",
          link: "http://localhost:3000/invite/tok2",
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
    await user.type(screen.getByLabelText("Email address"), "new@example.test");
    await user.click(screen.getByRole("button", { name: "Create invite" }));
    expect(
      await screen.findByText(
        "Email limit reached for today. Copy the link instead.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy link instead" }));
    expect(await screen.findByLabelText("Invite link")).toHaveValue(
      "http://localhost:3000/invite/tok2",
    );
  });
});
