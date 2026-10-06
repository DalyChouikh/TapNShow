import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { WelcomeFlow } from "./welcome-flow";

const replace = vi.fn();
const search = { value: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

const me = (displayName: string | null) => ({
  userId: "3c9e2a71-8f4b-4d2e-9a6c-1b5d7e0f2a34",
  profile: { displayName, avatarUrl: null, email: "a@example.test" },
  workspaces: [
    {
      id: "0b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
      slug: "club-ab12",
      name: "Club",
      role: "owner",
    },
  ],
  lastWorkspaceSlug: "club-ab12",
});

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
  search.value = "";
});

describe("WelcomeFlow", () => {
  it("goes straight to the last workspace when the name is known", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(me("Sami")))),
    );
    renderWithProviders(<WelcomeFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/w/club-ab12"));
  });

  it("asks for a name once, saves it, then honours a safe next", async () => {
    search.value = "next=%2Finvite%2Ftok123";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(me(null))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify(me("Lina"))));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<WelcomeFlow />);
    await user.type(await screen.findByLabelText("Your name"), "Lina");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/invite/tok123"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      displayName: "Lina",
    });
  });

  it("ignores an unsafe next", async () => {
    search.value = "next=%2F%2Fevil.example";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(me("Sami")))),
    );
    renderWithProviders(<WelcomeFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/w/club-ab12"));
  });
});
