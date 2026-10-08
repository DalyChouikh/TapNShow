import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { tokenInfoFixture } from "@/test/fixtures/tokens";
import { renderWithProviders } from "@/test/render";
import { ResponsePlaceholder } from "./response-placeholder";

const TOKEN = "c".repeat(43);
vi.mock("next/navigation", () => ({ useParams: () => ({ token: TOKEN }) }));

describe("ResponsePlaceholder", () => {
  it("shows the meeting in its own zone and that answering opens soon", async () => {
    routeFetch({ [`GET /api/r/${TOKEN}`]: json(tokenInfoFixture) });
    renderWithProviders(<ResponsePlaceholder />);
    expect(
      await screen.findByRole("heading", { name: "Answering opens soon" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fri 9 Oct, 18:00–19:00 (Africa/Tunis)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Room B12")).toBeInTheDocument();
  });

  it("says when the meeting was cancelled, and calls an unknown link invalid", async () => {
    routeFetch({
      [`GET /api/r/${TOKEN}`]: json({
        ...tokenInfoFixture,
        meeting: { ...tokenInfoFixture.meeting, status: "cancelled" },
      }),
    });
    const { unmount } = renderWithProviders(<ResponsePlaceholder />);
    expect(
      await screen.findByText("This meeting was cancelled."),
    ).toBeInTheDocument();
    unmount();
    routeFetch({
      [`GET /api/r/${TOKEN}`]: json({ error: { code: "not_found" } }, 404),
    });
    renderWithProviders(<ResponsePlaceholder />);
    expect(
      await screen.findByRole("heading", { name: "This link isn't valid" }),
    ).toBeInTheDocument();
  });
});
