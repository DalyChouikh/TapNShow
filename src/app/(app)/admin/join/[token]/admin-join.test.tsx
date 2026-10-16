import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminJoin } from "./admin-join";

const TOKEN = "t".repeat(43);
const mocks = vi.hoisted(() => ({ push: vi.fn<(href: string) => void>() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ token: TOKEN }),
  useRouter: () => ({ push: mocks.push }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const preview = (status: string, maskedEmail: string | null = null) =>
  json({ status, maskedEmail });

describe("AdminJoin", () => {
  it("accepts a ready invite with the token, then opens the admin area", async () => {
    const fetchMock = routeFetch({
      "POST /api/admin/invites/preview": preview("ready"),
      "POST /api/admin/invites/accept": json({ ok: true }),
      "GET /api/me": json({}),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminJoin />);
    expect(
      await screen.findByRole("heading", { name: "Help run TapNShow" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept the invite" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/admin"));
    const accept = fetchMock.mock.calls.find(
      ([url]) => url === "/api/admin/invites/accept",
    );
    expect(JSON.parse(String(accept?.[1]?.body))).toEqual({ token: TOKEN });
  });

  it("says plainly why accepting failed", async () => {
    routeFetch({
      "POST /api/admin/invites/preview": preview("ready"),
      "POST /api/admin/invites/accept": json(
        { error: { code: "rate_limited" } },
        429,
      ),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminJoin />);
    await user.click(
      await screen.findByRole("button", { name: "Accept the invite" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many/);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("names the invited address for the wrong account", async () => {
    routeFetch({
      "POST /api/admin/invites/preview": preview(
        "wrong_account",
        "l•••@example.test",
      ),
    });
    renderWithProviders(<AdminJoin />);
    expect(
      await screen.findByRole("heading", {
        name: "This invite is for l•••@example.test",
      }),
    ).toBeInTheDocument();
  });

  it("opens the admin area for someone who already is an admin", async () => {
    routeFetch({ "POST /api/admin/invites/preview": preview("already_admin") });
    renderWithProviders(<AdminJoin />);
    expect(
      await screen.findByText("You're already a platform admin."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the admin area" }),
    ).toHaveAttribute("href", "/admin");
  });

  it.each([
    ["expired", "This invite has expired. Ask the organizer for a new one."],
    ["revoked", "This invite was cancelled."],
    ["used", "This invite was already used."],
    [
      "not_found",
      "This invite link isn't valid. Check that you copied all of it.",
    ],
  ])("explains a %s invite", async (status, message) => {
    routeFetch({ "POST /api/admin/invites/preview": preview(status) });
    renderWithProviders(<AdminJoin />);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("says plainly when the invite can't be checked", async () => {
    routeFetch({
      "POST /api/admin/invites/preview": json(
        { error: { code: "rate_limited" } },
        429,
      ),
    });
    renderWithProviders(<AdminJoin />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many/);
  });
});
