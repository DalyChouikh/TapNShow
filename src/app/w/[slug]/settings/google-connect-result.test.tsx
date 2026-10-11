import { screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { GoogleConnectResult } from "./google-connect-result";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  params: { value: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => "/w/robotics-cd34/settings",
  useSearchParams: () => new URLSearchParams(mocks.params.value),
}));

afterEach(() => {
  vi.clearAllMocks();
  toast.dismiss();
  window.location.hash = "";
});

describe("GoogleConnectResult", () => {
  it("explains a Gmail connect error and removes it from the URL", async () => {
    mocks.params.value = "google_error=scope_denied&google_for=sending&tab=x";
    renderWithProviders(<GoogleConnectResult purpose="sending" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google didn't give permission to send email.",
    );
    expect(mocks.replace).toHaveBeenCalledWith(
      "/w/robotics-cd34/settings?tab=x",
      { scroll: false },
    );
  });

  it("confirms a Gmail connect with a toast", async () => {
    mocks.params.value = "google=connected&google_for=sending";
    renderWithProviders(<GoogleConnectResult purpose="sending" />, {
      toaster: true,
    });
    expect(
      await screen.findByText("Gmail connected. You can send meetings now."),
    ).toBeInTheDocument();
  });

  it("shows the Sheets toast only in the Sheets banner", async () => {
    mocks.params.value = "google=connected&google_for=sheets";
    renderWithProviders(
      <>
        <GoogleConnectResult purpose="sending" />
        <GoogleConnectResult purpose="sheets" />
      </>,
      { toaster: true },
    );
    expect(
      await screen.findByText(
        "Google Sheet connected. It fills in within a minute.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Gmail connected. You can send meetings now."),
    ).not.toBeInTheDocument();
  });

  it("explains a sheet in another account's Drive, keeping the hash on the cleaned URL", async () => {
    window.location.hash = "#sheets";
    mocks.params.value = "google_error=sheet_wrong_account&google_for=sheets";
    renderWithProviders(<GoogleConnectResult purpose="sheets" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This sheet is in another Google account's Drive. Pick that account, or create a new sheet.",
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/w/robotics-cd34/settings#sheets",
        { scroll: false },
      ),
    );
  });

  it("ignores a result meant for the other purpose", () => {
    mocks.params.value = "google_error=failed&google_for=sheets";
    renderWithProviders(<GoogleConnectResult purpose="sending" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
