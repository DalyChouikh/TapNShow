import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import {
  installMatchMedia,
  setCoarsePointer,
  setReducedMotion,
  setWideViewport,
} from "./src/test/match-media";
import { installConsoleGuard } from "./src/test/console-guard";

// next/font functions only exist inside the Next compiler; components that use a font get
// an empty class name in tests.
vi.mock("next/font/google", () => {
  const font = () => ({
    className: "",
    variable: "",
    style: { fontFamily: "" },
  });
  return { Archivo_Black: font, Space_Grotesk: font };
});
vi.mock("next/font/local", () => ({
  default: () => ({ className: "", variable: "", style: { fontFamily: "" } }),
}));

// Radix popovers and cmdk measure and scroll elements; jsdom lacks both APIs.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};
// Radix Select and sonner's swipe-to-dismiss use pointer capture, which jsdom does not implement.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

installMatchMedia();

// jsdom has no window.scrollTo; components that call it (dialogs restoring focus) get a no-op
// instead of jsdom's "Not implemented" error on stderr.
window.scrollTo = () => {};

const consoleGuard = installConsoleGuard();

afterEach(() => {
  cleanup();
  setReducedMotion(false);
  setWideViewport(false);
  setCoarsePointer(false);
  // Zero warnings (spec §12, M9): any console.error / console.warn a test didn't expect fails it.
  const problems = consoleGuard.take();
  if (problems.length > 0) {
    throw new Error(`Unexpected console output:\n${problems.join("\n")}`);
  }
});
