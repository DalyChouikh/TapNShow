import { describe, expect, it } from "vitest";

describe("unknown API addresses", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)(
    "%s answers 404 JSON",
    async (method) => {
      const route = await import("./route");
      const response = await route[method]();
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      await expect(response.json()).resolves.toEqual({
        error: { code: "not_found" },
      });
    },
  );
});
