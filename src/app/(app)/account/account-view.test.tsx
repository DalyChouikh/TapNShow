import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { meFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { AccountView } from "./account-view";

afterEach(() => vi.unstubAllGlobals());

describe("AccountView", () => {
  it("shows the name, the answers and the delete cards in that order", async () => {
    routeFetch({
      "GET /api/me": json(meFixture),
      "GET /api/me/account": json({
        owned: [],
        workspaces: 0,
        answersWithText: 0,
      }),
    });
    renderWithProviders(<AccountView />);
    expect(await screen.findByLabelText("Name")).toHaveValue("Amira Ben Ali");
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["Your name", "Your answers", "Delete my account"]);
    expect(
      screen.getByText(
        "Signed in as amira@example.test. Invites sent to this address show up in My invites.",
      ),
    ).toBeVisible();
  });

  it("offers Download my answers as CSV or Excel", async () => {
    routeFetch({
      "GET /api/me": json(meFixture),
      "GET /api/me/account": json({
        owned: [],
        workspaces: 0,
        answersWithText: 0,
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AccountView />);
    await user.click(
      await screen.findByRole("button", { name: "Download my answers" }),
    );
    expect(screen.getByRole("menuitem", { name: /CSV/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Excel/ })).toBeVisible();
  });
});
