import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminsFixture } from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { WaitingInvites } from "./waiting-invites";

const [invite] = adminsFixture.invites;
const RENEW = `POST /api/admin/invites/${invite.id}/renew`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T08:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bodyOf = (fetchMock: ReturnType<typeof routeFetch>, key: string) => {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => `${init?.method} ${String(url)}` === key,
  );
  return JSON.parse(String(call?.[1]?.body));
};

describe("WaitingInvites", () => {
  it("shows each waiting invite with when it expires", () => {
    renderWithProviders(<WaitingInvites invites={adminsFixture.invites} />);
    expect(
      screen.getByRole("heading", { name: "Invites waiting" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "l•••@example.testExpires in 6 days",
    );
  });

  it("copies a fresh link", async () => {
    const fetchMock = routeFetch({
      [RENEW]: json({ status: "link", link: "https://app.test/admin/join/x" }),
    });
    const user = userEvent.setup();
    renderWithProviders(<WaitingInvites invites={adminsFixture.invites} />, {
      toaster: true,
    });
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Invite link copied")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(
      "https://app.test/admin/join/x",
    );
    expect(bodyOf(fetchMock, RENEW)).toEqual({ delivery: "link" });
  });

  it("sends the invite again, and says when the day's emails ran out", async () => {
    let calls = 0;
    const fetchMock = routeFetch({
      [RENEW]: () => {
        calls += 1;
        return new Response(
          JSON.stringify({ status: calls === 1 ? "sent" : "email_limit" }),
        );
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<WaitingInvites invites={adminsFixture.invites} />, {
      toaster: true,
    });
    await user.click(screen.getByRole("button", { name: "Resend" }));
    expect(await screen.findByText("Invite sent again")).toBeInTheDocument();
    expect(bodyOf(fetchMock, RENEW)).toEqual({ delivery: "email" });
    await user.click(screen.getByRole("button", { name: "Resend" }));
    expect(
      await screen.findByText(
        "TapNShow sent all its emails for today. Use Copy link on the waiting invite instead.",
      ),
    ).toBeInTheDocument();
  });

  it("revokes only after the owner confirms", async () => {
    const fetchMock = routeFetch({
      [`DELETE /api/admin/invites/${invite.id}`]: json({ ok: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(<WaitingInvites invites={adminsFixture.invites} />, {
      toaster: true,
    });
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("dialog", {
      name: "Revoke the invite for l•••@example.test?",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("Invite revoked")).toBeInTheDocument();
  });

  it("shows nothing when no invite is waiting", () => {
    renderWithProviders(<WaitingInvites invites={[]} />);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
