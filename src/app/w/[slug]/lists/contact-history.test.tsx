import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { ContactHistory } from "./contact-history";

const CONTACT = "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
const MEETING = "4b7f8c2e-2f3a-4c55-9a1e-0d6f6b1c2a10";
const row = (title: string, answer: object | null, emailStatus = "sent") => ({
  meetingId: MEETING,
  title,
  startsAt: "2026-10-02T17:00:00+00:00",
  timezone: "Africa/Tunis",
  responseMode: "attendance",
  emailStatus,
  answer,
});

describe("ContactHistory", () => {
  it("shows the period's counts and past meetings, and refetches for another period", async () => {
    const urls: string[] = [];
    routeFetch(
      new Proxy(
        {},
        {
          get: (_target, key: string) => () => {
            urls.push(key);
            return new Response(
              JSON.stringify({
                counts: { attending: 8, late: 3, absent: 1, noReply: 2 },
                items: [
                  row("Weekly sync", {
                    status: "late",
                    delayMinutes: 20,
                    reason: "Bus <b>x</b>",
                    comment: "",
                    afterDeadline: false,
                    updatedAt: "2026-10-02T10:00:00+00:00",
                  }),
                  row("Kickoff", null),
                  row("Retro", null, "failed"),
                ],
                nextCursor: null,
              }),
            );
          },
        },
      ),
    );
    const { container } = renderWithProviders(
      <ContactHistory
        slug="club-ab12"
        contactId={CONTACT}
        timezone="Africa/Tunis"
      />,
    );
    expect(await screen.findByText("Late by 20 min")).toBeInTheDocument();
    expect(screen.getByText("Bus <b>x</b>")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    // "No reply" is the count's label and Kickoff's row.
    expect(screen.getAllByText("No reply")).toHaveLength(2);
    expect(screen.getByText("Email not delivered")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "History" })).toHaveTextContent(
      "3",
    );
    expect(urls[0]).toMatch(
      new RegExp(
        `GET /api/workspaces/club-ab12/contacts/${CONTACT}/history\\?from=`,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    await waitFor(() =>
      expect(urls.some((u) => u.endsWith("/history?limit=50"))).toBe(true),
    );
  });
});
