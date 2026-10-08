import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadTokenContext, requestCalendar, scheduleDispatch } = vi.hoisted(
  () => ({
    loadTokenContext: vi.fn(),
    requestCalendar: vi.fn(),
    scheduleDispatch: vi.fn(),
  }),
);
vi.mock("@/server/http/token-context", () => ({ loadTokenContext }));
vi.mock("@/server/queries/tokens", () => ({ requestCalendar }));
vi.mock("@/server/dispatch/schedule-dispatch", () => ({ scheduleDispatch }));

const TOKEN = "a".repeat(43);
const ctx = { params: Promise.resolve({ token: TOKEN }) };

function post(origin = "https://tapnshow.test") {
  return new Request(`https://tapnshow.test/api/r/${TOKEN}/calendar`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadTokenContext.mockResolvedValue({ ok: true, client: {}, tokenHash: "h" });
});

describe("POST /api/r/[token]/calendar", () => {
  it("records the request and kicks a dispatch", async () => {
    requestCalendar.mockResolvedValue({ data: true, error: null });
    const { POST } = await import("./route");
    const response = await POST(post(), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(requestCalendar).toHaveBeenCalledWith({}, "h");
    expect(scheduleDispatch).toHaveBeenCalledOnce();
  });

  it("refuses another site (403) before touching the token", async () => {
    const { POST } = await import("./route");
    expect((await POST(post("https://evil.test"), ctx)).status).toBe(403);
    expect(loadTokenContext).not.toHaveBeenCalled();
  });

  it("is 404 for an unknown token and 400 for a meeting that asks for answers", async () => {
    const { POST } = await import("./route");
    requestCalendar.mockResolvedValueOnce({ data: false, error: null });
    expect((await POST(post(), ctx)).status).toBe(404);
    requestCalendar.mockResolvedValueOnce({
      data: null,
      error: { message: "tn:invalid_choice" },
    });
    expect((await POST(post(), ctx)).status).toBe(400);
    expect(scheduleDispatch).not.toHaveBeenCalled();
  });
});
