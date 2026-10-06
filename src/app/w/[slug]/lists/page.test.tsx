import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { workspaceFixture } from "@/test/fixtures/me";
import ListsPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "robotics-cd34" }),
}));

beforeEach(() => {
  routeFetch({
    "GET /api/workspaces/robotics-cd34": json(workspaceFixture),
    "GET /api/workspaces/robotics-cd34/contacts": json(rosterFixture),
  });
});

describe("/w/[slug]/lists", () => {
  it("loads the roster", async () => {
    renderWithProviders(<ListsPage />);
    expect(await screen.findByText("3 people")).toBeInTheDocument();
  });
});
