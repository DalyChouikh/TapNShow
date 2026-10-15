import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceKind, needsHomeScreenSteps } from "./kind";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  ipadOld:
    "Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15 Version/16.4 Mobile/15E148 Safari/604.1",
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
};

function on(userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  // jsdom has no maxTouchPoints: define it like a browser would.
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: maxTouchPoints,
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("deviceKind", () => {
  it.each([
    [UA.iphone, 5, "iphone"],
    [UA.ipadOld, 5, "ipad"],
    // iPadOS Safari asks for desktop sites and says "Macintosh"; only touch gives it away.
    [UA.ipadDesktopMode, 5, "ipad"],
    [UA.ipadDesktopMode, 0, "computer"],
    [UA.androidPhone, 5, "phone"],
    [UA.androidTablet, 5, "tablet"],
    [UA.windows, 0, "computer"],
    [UA.linux, 0, "computer"],
    [UA.chromebook, 0, "computer"],
    ["SomethingElse/1.0", 0, "device"],
  ] as const)("%s (touch %i) is %s", (userAgent, touch, kind) => {
    on(userAgent, touch);
    expect(deviceKind()).toBe(kind);
  });
});

describe("needsHomeScreenSteps", () => {
  const standalone = (matches: boolean) =>
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches })),
    );

  it("is true on an iPhone or iPad in the browser, false once opened from the Home Screen", () => {
    on(UA.iphone, 5);
    standalone(false);
    expect(needsHomeScreenSteps()).toBe(true);
    standalone(true);
    expect(needsHomeScreenSteps()).toBe(false);
    on(UA.ipadDesktopMode, 5);
    standalone(false);
    expect(needsHomeScreenSteps()).toBe(true);
  });

  it("is false everywhere else", () => {
    on(UA.androidPhone, 5);
    standalone(false);
    expect(needsHomeScreenSteps()).toBe(false);
  });
});
