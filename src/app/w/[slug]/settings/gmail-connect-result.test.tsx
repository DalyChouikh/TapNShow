import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { renderWithProviders } from "@/test/render";
import { GmailConnectResult } from "./gmail-connect-result";

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
});

describe("GmailConnectResult", () => {
  it("explains a connect error and removes it from the URL", async () => {
    mocks.params.value = "gmail_error=scope_denied&tab=x";
    renderWithProviders(<GmailConnectResult />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google didn't give permission to send email.",
    );
    expect(mocks.replace).toHaveBeenCalledWith(
      "/w/robotics-cd34/settings?tab=x",
      { scroll: false },
    );
  });

  it("confirms a successful connect with a toast", async () => {
    mocks.params.value = "gmail=connected";
    renderWithProviders(<GmailConnectResult />, { toaster: true });
    expect(
      await screen.findByText("Gmail connected. You can send meetings now."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/w/robotics-cd34/settings", {
        scroll: false,
      }),
    );
  });
});
