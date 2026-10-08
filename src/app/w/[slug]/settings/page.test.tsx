import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { workspaceFixture } from "@/test/fixtures/me";
import SettingsPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "club-ab12" }),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/w/club-ab12/settings",
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(() => vi.unstubAllGlobals());

describe("/w/[slug]/settings", () => {
  it("holds the Danger zone's place with a skeleton while members load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/members")) {
          return new Promise<Response>(() => undefined);
        }
        if (url === "/api/me") {
          return new Response(
            JSON.stringify({
              userId: "00000000-0000-4000-8000-00000000000a",
              profile: {
                displayName: "Me",
                avatarUrl: null,
                email: "me@example.test",
              },
              workspaces: [],
              lastWorkspaceSlug: null,
            }),
          );
        }
        if (url.endsWith("/invites")) {
          return new Response("[]");
        }
        if (url.endsWith("/sender")) {
          return new Response(
            JSON.stringify({
              sender: null,
              ownerName: "Me",
              myConnections: [],
            }),
          );
        }
        if (url.endsWith("/meeting-defaults")) {
          return new Response(
            JSON.stringify({
              responseMode: "attendance",
              delayOptions: [5, 10],
              reasonRequired: true,
              commentsEnabled: false,
              footerNote: "",
              durationMinutes: 60,
            }),
          );
        }
        return new Response(JSON.stringify(workspaceFixture));
      }),
    );
    renderWithProviders(<SettingsPage />);
    expect(
      await screen.findByTestId("danger-zone-skeleton"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Sending" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Meeting defaults" }),
    ).toBeInTheDocument();
  });
});
