import { beforeEach, describe, expect, it, vi } from "vitest";

type CookieRecord = { name: string; value: string; options?: object };
type CookieAdapter = {
  cookies: {
    getAll: () => CookieRecord[];
    setAll: (cookies: CookieRecord[]) => void;
  };
};

// vi.mock factories are hoisted above imports, so shared doubles must be created with vi.hoisted.
const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(
    (url: string, key: string, options: CookieAdapter) => ({
      url,
      key,
      options,
    }),
  ),
  cookieStore: {
    getAll: vi.fn((): CookieRecord[] => [{ name: "sb", value: "1" }]),
    set: vi.fn(),
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("next/headers", () => ({ cookies: async () => mocks.cookieStore }));

describe("createSupabaseServerClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the publishable key and delegates cookies to Next", async () => {
    const { createSupabaseServerClient } = await import("./server-client");
    await createSupabaseServerClient();
    const [url, key, options] = mocks.createServerClient.mock.calls[0];
    expect(url).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(key).toBe(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(options.cookies.getAll()).toEqual([{ name: "sb", value: "1" }]);
    options.cookies.setAll([{ name: "sb", value: "2", options: {} }]);
    expect(mocks.cookieStore.set).toHaveBeenCalledWith("sb", "2", {});
  });
});
