import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { LoginScreen } from "./login-screen";

const state = vi.hoisted(() => ({ search: "", enabled: true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/config/public-env", () => ({
  publicEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    get NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED() {
      return state.enabled;
    },
  },
}));

afterEach(() => {
  state.search = "";
  state.enabled = true;
});

describe("LoginScreen with Google", () => {
  it("shows the Google option only when enabled, carrying next", () => {
    state.search = "next=%2Fw%2Fclub-ab12";
    const { unmount } = renderWithProviders(<LoginScreen />);
    expect(
      screen.getByRole("link", { name: "Continue with Google" }),
    ).toHaveAttribute("href", "/api/auth/google/start?next=%2Fw%2Fclub-ab12");
    unmount();
    state.enabled = false;
    renderWithProviders(<LoginScreen />);
    expect(
      screen.queryByRole("link", { name: "Continue with Google" }),
    ).toBeNull();
  });

  it("explains a failed Google round trip", () => {
    state.search = "error=google_failed";
    renderWithProviders(<LoginScreen />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google sign-in didn't finish.",
    );
  });

  it("explains that Google is unavailable here", () => {
    state.search = "error=google_unavailable";
    renderWithProviders(<LoginScreen />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google sign-in isn't available here. Use an email code.",
    );
  });
});
