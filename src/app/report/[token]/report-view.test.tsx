import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { tokenInfoFixture } from "@/test/fixtures/tokens";
import { renderWithProviders } from "@/test/render";
import { ReportView } from "./report-view";

const TOKEN = "b".repeat(43);
vi.mock("next/navigation", () => ({ useParams: () => ({ token: TOKEN }) }));

describe("ReportView", () => {
  it("reports and unsubscribes after the click, then thanks the person", async () => {
    let info = { ...tokenInfoFixture };
    const fetchMock = routeFetch({
      [`GET /api/r/${TOKEN}`]: () => new Response(JSON.stringify(info)),
      [`POST /api/r/${TOKEN}/report`]: () => {
        info = { ...info, unsubscribed: true, reported: true };
        return new Response(JSON.stringify({ ok: true }));
      },
    });
    renderWithProviders(<ReportView />);
    expect(
      await screen.findByRole("heading", { name: "Don't know this group?" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Report and unsubscribe" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Thanks for telling us" }),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });

  it("calls an unknown link invalid", async () => {
    routeFetch({
      [`GET /api/r/${TOKEN}`]: json({ error: { code: "not_found" } }, 404),
    });
    renderWithProviders(<ReportView />);
    expect(
      await screen.findByRole("heading", { name: "This link isn't valid" }),
    ).toBeInTheDocument();
  });
});
