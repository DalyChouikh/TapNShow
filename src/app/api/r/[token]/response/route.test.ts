import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadTokenContext, submitAnswer, scheduleDispatch } = vi.hoisted(() => ({
  loadTokenContext: vi.fn(),
  submitAnswer: vi.fn(),
  scheduleDispatch: vi.fn(),
}));
vi.mock("@/server/http/token-context", () => ({ loadTokenContext }));
vi.mock("@/server/queries/tokens", () => ({ submitAnswer }));
vi.mock("@/server/dispatch/schedule-dispatch", () => ({ scheduleDispatch }));

const TOKEN = "a".repeat(43);
const ctx = { params: Promise.resolve({ token: TOKEN }) };
const ANSWER = {
  status: "late",
  delayMinutes: 10,
  reason: "Bus",
  comment: "",
  afterDeadline: false,
  respondedAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:00.000Z",
};

function put(body: object, origin = "https://tapnshow.test") {
  return new Request(`https://tapnshow.test/api/r/${TOKEN}/response`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadTokenContext.mockResolvedValue({ ok: true, client: {}, tokenHash: "h" });
});

describe("PUT /api/r/[token]/response", () => {
  it("saves the answer and kicks a dispatch", async () => {
    submitAnswer.mockResolvedValue({ data: ANSWER, error: null });
    const { PUT } = await import("./route");
    const response = await PUT(
      put({ status: "late", delayMinutes: 10, reason: "Bus", comment: "" }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ANSWER);
    expect(submitAnswer).toHaveBeenCalledWith({}, "h", {
      status: "late",
      delayMinutes: 10,
      reason: "Bus",
      comment: "",
    });
    expect(scheduleDispatch).toHaveBeenCalledOnce();
  });

  it("refuses another site (403) before touching the token", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      put(
        { status: "attending", delayMinutes: null, reason: "", comment: "" },
        "https://evil.test",
      ),
      ctx,
    );
    expect(response.status).toBe(403);
    expect(loadTokenContext).not.toHaveBeenCalled();
  });

  it("maps database rules to plain errors", async () => {
    submitAnswer.mockResolvedValue({
      data: null,
      error: { message: "tn:answers_closed" },
    });
    const { PUT } = await import("./route");
    const response = await PUT(
      put({ status: "attending", delayMinutes: null, reason: "", comment: "" }),
      ctx,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "answers_closed" },
    });
  });

  it("is 404 for an unknown token and 400 for a bad body", async () => {
    submitAnswer.mockResolvedValue({ data: null, error: null });
    const { PUT } = await import("./route");
    expect(
      (
        await PUT(
          put({
            status: "attending",
            delayMinutes: null,
            reason: "",
            comment: "",
          }),
          ctx,
        )
      ).status,
    ).toBe(404);
    expect((await PUT(put({ status: "maybe" }), ctx)).status).toBe(400);
    expect(scheduleDispatch).not.toHaveBeenCalled();
  });
});
