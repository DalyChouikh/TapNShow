import { describe, expect, it } from "vitest";
import { createConsoleGuard } from "./console-guard";

type FakeConsole = {
  error: (...args: string[]) => void;
  warn: (...args: string[]) => void;
};

describe("createConsoleGuard", () => {
  it("collects console.error and console.warn calls", () => {
    const target: FakeConsole = { error: () => {}, warn: () => {} };
    const guard = createConsoleGuard(target);
    target.error("Warning: %s is deprecated", "x");
    target.warn("careful");
    expect(guard.take()).toEqual([
      "console.error: Warning: x is deprecated",
      "console.warn: careful",
    ]);
    expect(guard.take()).toEqual([]);
  });

  it("lets a test expect a message, once per test", () => {
    const target: FakeConsole = { error: () => {}, warn: () => {} };
    const guard = createConsoleGuard(target);
    guard.allow(/expected boom/);
    target.error("expected boom happened");
    expect(guard.take()).toEqual([]);
    target.error("expected boom happened");
    expect(guard.take()).toEqual(["console.error: expected boom happened"]);
  });
});
