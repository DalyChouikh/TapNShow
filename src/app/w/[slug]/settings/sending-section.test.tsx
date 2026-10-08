import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { SendingSection } from "./sending-section";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/w/robotics-cd34/settings",
  useSearchParams: () => new URLSearchParams(),
}));

const CONN = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60";
const OTHER = "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f61";
const path = "/api/workspaces/robotics-cd34/sender";
const active = {
  sender: {
    connectionId: CONN,
    email: "club@gmail.com",
    status: "active",
    connectedBy: "Amira Ben Ali",
    connectedAt: "2026-10-07T10:00:00Z",
    isMine: true,
    sentLast24h: 12,
    dailyLimit: 400,
  },
  ownerName: "Amira Ben Ali",
  myConnections: [
    {
      id: CONN,
      email: "club@gmail.com",
      status: "active",
      usedBy: ["Robotics Club", "Chess Club"],
    },
    { id: OTHER, email: "other@gmail.com", status: "active", usedBy: [] },
  ],
};

describe("SendingSection", () => {
  it("guides the Owner to connect when nothing is connected", async () => {
    routeFetch({
      [`GET ${path}`]: json({
        sender: null,
        ownerName: "Amira Ben Ali",
        myConnections: [],
      }),
    });
    renderWithProviders(<SendingSection workspace={workspaceFixture} />);
    const connect = await screen.findByRole("link", { name: "Connect Gmail" });
    expect(connect).toHaveAttribute(
      "href",
      "/api/integrations/google/connect?workspace=robotics-cd34",
    );
    expect(
      screen.getByText(/connect your group's own Gmail/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/verified/)).toBeNull();
  });

  it("shows the sender, usage and lets the person who connected it disconnect after confirming", async () => {
    const fetchMock = routeFetch({
      [`GET ${path}`]: json(active),
      [`DELETE /api/integrations/google/connections/${CONN}`]: json({
        ok: true,
      }),
    });
    renderWithProviders(<SendingSection workspace={workspaceFixture} />, {
      toaster: true,
    });
    expect(
      await screen.findByText("Sending from Robotics Club <club@gmail.com>"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("12 of 400 emails in the last 24 hours"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Disconnect club@gmail.com" }),
    );
    expect(
      screen.getByText(/Sending pauses in: Robotics Club, Chess Club/),
    ).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Disconnect",
      }),
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(true);
  });

  it("switches to another of my connections after confirming", async () => {
    const fetchMock = routeFetch({
      [`GET ${path}`]: json(active),
      [`PUT ${path}`]: json({ ok: true }),
    });
    renderWithProviders(<SendingSection workspace={workspaceFixture} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Use other@gmail.com" }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Use other@gmail.com",
      }),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ connectionId: OTHER });
  });

  it("tells Admins who can change it", async () => {
    routeFetch({
      [`GET ${path}`]: json({
        ...active,
        sender: { ...active.sender, isMine: false },
        myConnections: [],
      }),
    });
    renderWithProviders(
      <SendingSection workspace={{ ...workspaceFixture, myRole: "admin" }} />,
    );
    expect(
      await screen.findByText(
        "Only Amira Ben Ali, the Owner, can connect or change the sending Gmail.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Gmail/ }),
    ).not.toBeInTheDocument();
  });
});
