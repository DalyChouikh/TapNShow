import { describe, expect, it } from "vitest";
import { apiError, fromDatabaseError } from "./errors";

describe("fromDatabaseError", () => {
  it("maps tn:<code> to the API code and status", async () => {
    const response = fromDatabaseError({
      code: "P0001",
      message: "tn:name_mismatch",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "name_mismatch" } });
  });

  it("maps Postgres classes without leaking messages", async () => {
    expect(
      fromDatabaseError({
        code: "42501",
        message: "permission denied for table x",
      }).status,
    ).toBe(403);
    expect(
      fromDatabaseError({ code: "23514", message: "violates check constraint" })
        .status,
    ).toBe(400);
    expect(
      fromDatabaseError({ code: "23505", message: "duplicate key" }).status,
    ).toBe(409);
    const unknown = fromDatabaseError({
      code: "XX000",
      message: "secret internals at 10.0.0.1",
    });
    expect(unknown.status).toBe(500);
    expect(JSON.stringify(await unknown.json())).not.toContain("10.0.0.1");
  });

  it("ignores unknown tn codes", () => {
    expect(
      fromDatabaseError({ code: "P0001", message: "tn:made_up" }).status,
    ).toBe(500);
  });
});

describe("apiError", () => {
  it("adds details only when given", async () => {
    expect(
      await apiError("invite_email_limit", { inviteId: "i1" }).json(),
    ).toEqual({
      error: { code: "invite_email_limit", details: { inviteId: "i1" } },
    });
  });
});

describe("fromDatabaseError overrides", () => {
  it("maps a Postgres code to a specific API code when the route knows the meaning", async () => {
    const response = fromDatabaseError(
      { code: "23505", message: "duplicate key" },
      { "23505": "contact_email_taken" },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "contact_email_taken" },
    });
  });

  it("still prefers tn:<code> from our functions", async () => {
    const response = fromDatabaseError(
      { code: "P0001", message: "tn:contacts_limit_reached" },
      { P0001: "conflict" },
    );
    expect(await response.json()).toEqual({
      error: { code: "contacts_limit_reached" },
    });
  });
});
