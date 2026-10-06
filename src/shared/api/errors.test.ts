import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { API_ERROR_CODES } from "./errors";

describe("ApiErrors messages", () => {
  it("translate every error code", () => {
    expect(
      API_ERROR_CODES.filter((code) => !(code in messages.ApiErrors)),
    ).toEqual([]);
  });
});
