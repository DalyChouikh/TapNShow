import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { LoginScreen } from "./login-screen";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams("next=%2Fw%2Fclub-ab12"),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
});

function stubFetch(
  ...responses: Array<{ status: number; body: object }>
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  for (const { status, body } of responses) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }),
    );
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("LoginScreen", () => {
  it("sends a code, accepts a pasted code with spaces, and continues to /welcome with next", async () => {
    const fetchMock = stubFetch(
      { status: 200, body: { ok: true } },
      { status: 200, body: { ok: true } },
    );
    const user = userEvent.setup();
    renderWithProviders(<LoginScreen />);
    await user.type(screen.getByLabelText("Email"), "ali@example.test");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Sign-in code"), "1234 5678");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/welcome?next=%2Fw%2Fclub-ab12"),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      email: "ali@example.test",
      code: "12345678",
    });
  });

  it("shows the translated server error for a wrong code", async () => {
    stubFetch(
      { status: 200, body: { ok: true } },
      { status: 400, body: { error: { code: "invalid_code" } } },
    );
    const user = userEvent.setup();
    renderWithProviders(<LoginScreen />);
    await user.type(screen.getByLabelText("Email"), "ali@example.test");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    await user.type(await screen.findByLabelText("Sign-in code"), "00000000");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText(
        "That code is wrong or has expired. Check the email or send a new code.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps Resend disabled during the countdown", async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const user = userEvent.setup();
    renderWithProviders(<LoginScreen />);
    await user.type(screen.getByLabelText("Email"), "ali@example.test");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(
      await screen.findByRole("button", { name: /Resend code in/ }),
    ).toBeDisabled();
  });
});
