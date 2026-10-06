import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import {
  installMatchMedia,
  setReducedMotion,
  setWideViewport,
} from "./src/test/match-media";

// next/font functions only exist inside the Next compiler; components that use a font get
// an empty class name in tests.
vi.mock("next/font/google", () => {
  const font = () => ({
    className: "",
    variable: "",
    style: { fontFamily: "" },
  });
  return { Archivo_Black: font, Google_Sans: font, Space_Grotesk: font };
});

// Radix popovers and cmdk measure and scroll elements; jsdom lacks both APIs.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};
// Radix Select uses pointer capture, which jsdom does not implement.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

installMatchMedia();

afterEach(() => {
  cleanup();
  setReducedMotion(false);
  setWideViewport(false);
});
