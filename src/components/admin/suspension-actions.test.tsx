import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_WORKSPACE_ID,
  workspaceDetailFixture,
} from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { SuspensionActions } from "./suspension-actions";

const SUSPENSION = `/api/admin/workspaces/${ADMIN_WORKSPACE_ID}/suspension`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SuspensionActions", () => {
  it("suspends sending only after the admin confirms", async () => {
    const fetchMock = routeFetch({
      [`POST ${SUSPENSION}`]: json({ ok: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <SuspensionActions workspace={workspaceDetailFixture()} />,
      { toaster: true },
    );
    expect(screen.queryByRole("status")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Suspend sending" }));
    const dialog = screen.getByRole("dialog", {
      name: "Suspend sending for Robotics Club?",
    });
    expect(dialog).toHaveTextContent(
      "Queued emails pause and new sends are refused. The Owner gets an email.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "Suspend sending" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        SUSPENSION,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(
      await screen.findByText("Sending suspended for Robotics Club"),
    ).toBeInTheDocument();
  });

  it("shows why sending is suspended and lifts it after the admin confirms", async () => {
    const fetchMock = routeFetch({
      [`DELETE ${SUSPENSION}`]: json({ ok: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <SuspensionActions
        workspace={workspaceDetailFixture({
          suspended: true,
          suspensions: [
            {
              id: "1b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
              reason: "auto_reports",
              createdAt: "2026-10-15T12:00:00+00:00",
              createdByName: null,
              liftedAt: null,
              liftedByName: null,
            },
          ],
        })}
      />,
      { toaster: true },
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sending suspended automatically3 reports from 74 people emailed in 7 days (4.1%)",
    );
    await user.click(screen.getByRole("button", { name: "Lift suspension" }));
    const dialog = screen.getByRole("dialog", {
      name: "Lift the suspension of Robotics Club?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Lift suspension" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        SUSPENSION,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(
      await screen.findByText("Sending is back on for Robotics Club"),
    ).toBeInTheDocument();
  });

  it("gives no rate when an admin suspended a workspace nobody reported", () => {
    renderWithProviders(
      <SuspensionActions
        workspace={workspaceDetailFixture({
          suspended: true,
          reports7d: 0,
          people7d: 0,
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Sending suspended by an admin$/,
    );
  });

  it("says plainly when the write is refused", async () => {
    routeFetch({
      [`POST ${SUSPENSION}`]: json({ error: { code: "rate_limited" } }, 429),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <SuspensionActions workspace={workspaceDetailFixture()} />,
      { toaster: true },
    );
    await user.click(screen.getByRole("button", { name: "Suspend sending" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Suspend sending",
      }),
    );
    expect(await screen.findByText(/Too many/)).toBeInTheDocument();
  });

  it("copies the full Owner email and says so", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SuspensionActions workspace={workspaceDetailFixture()} />,
      { toaster: true },
    );
    await user.click(screen.getByRole("button", { name: "Copy Owner email" }));
    expect(await navigator.clipboard.readText()).toBe("amira@example.test");
    expect(await screen.findByText("Owner email copied")).toBeInTheDocument();
  });

  it("tells the admin when the browser refuses to copy", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    renderWithProviders(
      <SuspensionActions workspace={workspaceDetailFixture()} />,
      { toaster: true },
    );
    await user.click(screen.getByRole("button", { name: "Copy Owner email" }));
    expect(
      await screen.findByText("Couldn't copy. Select the address instead."),
    ).toBeInTheDocument();
  });

  it("offers no copy button when the workspace has no Owner", () => {
    renderWithProviders(
      <SuspensionActions
        workspace={workspaceDetailFixture({ ownerEmail: null })}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Copy Owner email" }),
    ).toBeNull();
  });
});
