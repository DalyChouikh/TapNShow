import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountSummary } from "@/shared/api/account";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { DeleteAccountCard } from "./delete-account-card";

const mocks = vi.hoisted(() => ({
  steps: [] as string[],
  replaceWith: vi.fn<(href: string) => void>(),
}));
vi.mock("@/lib/navigation", () => ({
  replaceWith: (href: string) => {
    mocks.steps.push(`go ${href}`);
    mocks.replaceWith(href);
  },
}));
vi.mock("@/lib/auth-redirect", () => ({
  redirectToLogin: () => {
    mocks.steps.push("go /login (signed out)");
  },
}));
vi.mock("@/lib/device/clear", () => ({
  clearDeviceData: async () => {
    mocks.steps.push("clear device");
  },
}));

const member: AccountSummary = {
  owned: [],
  workspaces: 2,
  answersWithText: 14,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.steps = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("DeleteAccountCard", () => {
  it("lists owned workspaces with the way out, and keeps Delete off", async () => {
    routeFetch({
      "GET /api/me/account": json({
        ...member,
        owned: [{ name: "Robotics Club", slug: "robotics-cd34" }],
      }),
    });
    renderWithProviders(<DeleteAccountCard />);
    expect(await screen.findByText("Robotics Club")).toBeVisible();
    for (const name of ["Transfer ownership", "Delete workspace"]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "href",
        "/w/robotics-cd34/settings#danger",
      );
    }
    expect(
      screen.getByRole("button", { name: "Delete my account" }),
    ).toBeDisabled();
  });

  it("names what goes, deletes after the word, then clears this device and leaves", async () => {
    let deleted = false;
    const fetchMock = routeFetch({
      // Once the account is gone, any refetch is signed out.
      "GET /api/me/account": () =>
        deleted
          ? new Response(
              JSON.stringify({
                error: { code: "unauthenticated", message: "x" },
              }),
              {
                status: 401,
              },
            )
          : new Response(JSON.stringify(member)),
      "DELETE /api/me": () => {
        deleted = true;
        mocks.steps.push("delete");
        return new Response(JSON.stringify({ ok: true }));
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<DeleteAccountCard />);
    await user.click(
      await screen.findByRole("button", { name: "Delete my account" }),
    );
    expect(
      screen.getByText(
        "Your reasons and comments on 14 answers are erased, and you leave 2 workspaces. Groups keep whether you came. This can't be undone.",
      ),
    ).toBeVisible();
    const dialog = screen.getByRole("dialog");
    const confirm = screen
      .getAllByRole("button", { name: "Delete my account" })
      .at(-1);
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Type confirm to delete"), "confirm");
    expect(dialog).toBeVisible();
    await user.click(confirm!);
    await waitFor(() =>
      expect(mocks.replaceWith).toHaveBeenCalledWith("/login?deleted=1"),
    );
    expect(mocks.steps).toEqual([
      "delete",
      "clear device",
      "go /login?deleted=1",
    ]);
    const body = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "DELETE",
    )?.[1]?.body;
    expect(JSON.parse(String(body))).toEqual({ confirm: "confirm" });
  });

  it("says plainly when the server still finds an owned workspace", async () => {
    routeFetch({
      "GET /api/me/account": json(member),
      "DELETE /api/me": json(
        { error: { code: "owns_workspaces", message: "x" } },
        409,
      ),
    });
    const user = userEvent.setup();
    renderWithProviders(<DeleteAccountCard />);
    await user.click(
      await screen.findByRole("button", { name: "Delete my account" }),
    );
    await user.type(screen.getByLabelText("Type confirm to delete"), "confirm");
    await user.click(
      screen.getAllByRole("button", { name: "Delete my account" }).at(-1)!,
    );
    expect(
      await screen.findByText(
        "You own a workspace. Give it to an Admin or delete it first.",
      ),
    ).toBeVisible();
    expect(mocks.steps).toEqual([]);
  });
});
