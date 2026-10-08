import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { tokenInfoFixture } from "@/test/fixtures/tokens";
import { renderWithProviders } from "@/test/render";
import { UnsubscribeView } from "./unsubscribe-view";

const TOKEN = "a".repeat(43);
vi.mock("next/navigation", () => ({ useParams: () => ({ token: TOKEN }) }));

describe("UnsubscribeView", () => {
  it("never unsubscribes on load; the button does, and the person can come back", async () => {
    let info = { ...tokenInfoFixture };
    const fetchMock = routeFetch({
      [`GET /api/r/${TOKEN}`]: () => new Response(JSON.stringify(info)),
      [`POST /api/r/${TOKEN}/unsubscribe`]: () => {
        info = { ...info, unsubscribed: true };
        return new Response(JSON.stringify({ ok: true }));
      },
      [`POST /api/r/${TOKEN}/resubscribe`]: () => {
        info = { ...info, unsubscribed: false };
        return new Response(JSON.stringify({ ok: true }));
      },
    });
    renderWithProviders(<UnsubscribeView />);
    expect(
      await screen.findByRole("heading", {
        name: "Stop emails from Robotics Club?",
      }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(
      await screen.findByRole("heading", { name: "You're unsubscribed" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Subscribe again" }),
    );
    expect(
      await screen.findByRole("heading", { name: "You're subscribed again" }),
    ).toBeInTheDocument();
  });

  it("calls an unknown link invalid", async () => {
    routeFetch({
      [`GET /api/r/${TOKEN}`]: json({ error: { code: "not_found" } }, 404),
    });
    renderWithProviders(<UnsubscribeView />);
    expect(
      await screen.findByRole("heading", { name: "This link isn't valid" }),
    ).toBeInTheDocument();
  });
});
