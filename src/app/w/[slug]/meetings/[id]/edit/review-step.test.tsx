import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import {
  audienceFixture,
  meetingFixture,
  MEETING_IDS,
} from "@/test/fixtures/meetings";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { StepHarness } from "@/test/wizard";
import { ReviewStep } from "./review-step";
import { WIZARD_STEPS } from "./wizard-steps";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/w/robotics-cd34/meetings/x/edit",
  useSearchParams: () => new URLSearchParams("step=review"),
}));

const base = `/api/workspaces/${workspaceFixture.slug}`;
const meetingPath = `${base}/meetings/${MEETING_IDS.meeting}`;
const sender = (overrides: object = {}) => ({
  sender: {
    connectionId: "3f1c2b8e-6a43-4f0e-9a51-1f2c3d4e5f60",
    email: "club@gmail.com",
    status: "active",
    connectedBy: "Daly",
    connectedAt: "2026-10-07T10:00:00Z",
    isMine: true,
    sentLast24h: 12,
    dailyLimit: 400,
  },
  ownerName: "Daly",
  myConnections: [],
  ...overrides,
});
let fetchMock: ReturnType<typeof routeFetch>;

const routes = (senderBody: object) => ({
  [`GET ${meetingPath}/audience`]: json(audienceFixture),
  [`GET ${base}/sender`]: json(senderBody),
  [`GET ${base}/contacts`]: json({
    contacts: [],
    lists: [
      { id: MEETING_IDS.members, name: "Members", contactCount: 2 },
      { id: MEETING_IDS.committee, name: "Committee", contactCount: 2 },
    ],
    limits: { contactsMax: 2000, listsMax: 50, importRowsMax: 2000 },
  }),
  [`GET ${meetingPath}/preview`]: json({
    subject: "Weekly sync · Fri 9 Oct, 18:00",
    html: "<p>Hi Amira</p>",
    fromName: "Robotics Club",
    fromEmail: "club@gmail.com",
    recipientName: "Amira B.",
  }),
  [`POST ${meetingPath}/send`]: json({ invited: 2, skippedUnsubscribed: 1 }),
});

const renderReview = (workspace = workspaceFixture, meeting = meetingFixture) =>
  renderWithProviders(
    <StepHarness
      Step={ReviewStep}
      slug={workspace.slug}
      meeting={meeting}
      workspace={workspace}
      steps={WIZARD_STEPS}
      goTo={vi.fn()}
    />,
    { toaster: true },
  );

beforeEach(() => {
  push.mockReset();
});

describe("ReviewStep", () => {
  it("summarizes, shows sender and quota, and sends only after the confirm dialog", async () => {
    fetchMock = routeFetch(routes(sender()));
    renderReview();
    expect(
      await screen.findByText("From Robotics Club <club@gmail.com>"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 emails now · 386 left today on this Gmail"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 unsubscribed skipped")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Send 2 invites" }),
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
    const dialog = screen.getByRole("dialog", {
      name: "Send 2 invites from club@gmail.com now?",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send 2 invites" }),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/send") && init?.method === "POST",
      ),
    ).toBe(true);
    expect(push).toHaveBeenCalledWith(
      `/w/${workspaceFixture.slug}/meetings/${MEETING_IDS.meeting}`,
    );
  });

  it("lets an Admin without a sender only save the draft", async () => {
    fetchMock = routeFetch(routes(sender({ sender: null })));
    renderReview({ ...workspaceFixture, myRole: "admin" });
    expect(
      await screen.findByText(
        "Ask Daly to connect Gmail to send. You can save this draft.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Send/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  it("gives the Owner a connect link that returns to this step", async () => {
    fetchMock = routeFetch(routes(sender({ sender: null })));
    renderReview({ ...workspaceFixture, myRole: "owner" });
    const link = await screen.findByRole("link", {
      name: "Connect Gmail to send",
    });
    expect(link.getAttribute("href")).toBe(
      `/api/integrations/google/connect?workspace=${workspaceFixture.slug}&next=${encodeURIComponent(`/w/${workspaceFixture.slug}/meetings/${MEETING_IDS.meeting}/edit?step=review`)}`,
    );
  });

  it("opens the email preview in a sandboxed frame", async () => {
    fetchMock = routeFetch(routes(sender()));
    renderReview();
    await userEvent.click(await screen.findByRole("button", { name: "Open" }));
    const frame = await screen.findByTitle("Email preview");
    // No scripts ever run in the preview; same-origin only lets the app measure its height
    // (the dialog scrolls, not the frame: nested scrolling sticks on phones).
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame).toHaveClass("pointer-events-none");
    expect(frame.getAttribute("srcdoc")).toContain("Hi Amira");
  });

  it("names the online place in the summary", async () => {
    fetchMock = routeFetch(routes(sender()));
    renderReview(workspaceFixture, {
      ...meetingFixture,
      locationMode: "online",
      locationText: "",
      onlineText: "Club Discord",
    });
    expect(await screen.findByText(/· Club Discord/)).toBeInTheDocument();
  });

  describe("a deadline that no longer fits (meeting at 18:00 Tunis on 9 Oct)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-09T08:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    it.each([
      [
        "2026-10-09T17:30:00.000Z",
        "The answer deadline must be before the meeting starts.",
      ],
      ["2026-10-09T07:00:00.000Z", "The answer deadline has passed."],
    ])("says why and holds Send (deadline %s)", async (deadline, message) => {
      fetchMock = routeFetch(routes(sender()));
      renderReview(workspaceFixture, {
        ...meetingFixture,
        responseDeadline: deadline,
      });
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Send 2 invites" }),
      ).toBeDisabled();
    });
  });
});
