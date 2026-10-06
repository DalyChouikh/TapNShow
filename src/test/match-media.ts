let reducedMotion = false;
let wideViewport = false;

/**
 * Toggles the emulated `prefers-reduced-motion: reduce` media query for tests.
 * @param value - true to emulate a user who prefers reduced motion
 */
export function setReducedMotion(value: boolean): void {
  reducedMotion = value;
}

/**
 * Emulates a wide screen for `(min-width: …)` media queries in tests.
 * @param value - true to make min-width queries match
 */
export function setWideViewport(value: boolean): void {
  wideViewport = value;
}

/** Installs a deterministic `window.matchMedia` (jsdom has none). */
export function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: query.includes("prefers-reduced-motion")
        ? reducedMotion
        : query.includes("min-width")
          ? wideViewport
          : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
