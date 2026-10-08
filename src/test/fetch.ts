import { vi } from "vitest";

/** Handler for one `"METHOD /path"` key; receives the request init (body etc.). */
export type FetchRoute = (init?: RequestInit) => Response | Promise<Response>;

/** Stubs global `fetch` by `"METHOD /path"`; unknown calls fail loudly. */
export function routeFetch(routes: Record<string, FetchRoute>) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      const handler = routes[key];
      if (!handler) {
        throw new Error(`unexpected ${key}`);
      }
      return handler(init);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** JSON response factory for `routeFetch`. */
export const json =
  (body: object, status = 200): FetchRoute =>
  () =>
    new Response(JSON.stringify(body), { status });
