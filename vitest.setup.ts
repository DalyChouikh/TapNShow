import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { installMatchMedia, setReducedMotion } from "./src/test/match-media";

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

installMatchMedia();

afterEach(() => {
  cleanup();
  setReducedMotion(false);
});
