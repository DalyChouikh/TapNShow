import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logItemFixture } from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminLogView } from "./admin-log";

afterEach(() => vi.unstubAllGlobals());

describe("AdminLogView", () => {
  it("shows everything first and filters to the admins' changes", async () => {
    routeFetch({
      "GET /api/admin/log?filter=all&limit=25": json({
        items: [logItemFixture()],
        nextCursor: null,
      }),
      "GET /api/admin/log?filter=admins&limit=25": json({
        items: [],
        nextCursor: null,
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminLogView />);
    expect(
      await screen.findByText("Sami suspended sending · Robotics Club"),
    ).toBeInTheDocument();
    expect(screen.getByText("That's the whole log.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Everything" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("radio", { name: "Admins" }));
    expect(await screen.findByText("Nothing logged yet.")).toBeInTheDocument();
  });
});
