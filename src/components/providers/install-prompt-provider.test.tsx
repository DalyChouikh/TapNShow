import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { InstallPromptProvider } from "./install-prompt-provider";

const wrapper = ({ children }: { children: ReactNode }) => (
  <InstallPromptProvider>{children}</InstallPromptProvider>
);

function device(options: { userAgent?: string; standalone?: boolean } = {}) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    options.userAgent ?? "Mozilla/5.0 (Linux; Android 14) Chrome/131 Mobile",
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: options.standalone ?? false })),
  );
}

function installPrompt() {
  const prompt = vi.fn<() => Promise<void>>(async () => undefined);
  const event = Object.assign(new Event("beforeinstallprompt"), {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
  });
  return { event, prompt };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useInstallPrompt", () => {
  it("offers Install once the browser allows it, and prompts once", async () => {
    device();
    const { result } = renderHook(() => useInstallPrompt(), { wrapper });
    expect(result.current.canInstall).toBe(false);
    const { event, prompt } = installPrompt();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(result.current.canInstall).toBe(true);
    await act(async () => {
      await result.current.install();
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(result.current.canInstall).toBe(false);
  });

  it("stops offering once the app is installed", () => {
    device();
    const { result } = renderHook(() => useInstallPrompt(), { wrapper });
    act(() => {
      window.dispatchEvent(installPrompt().event);
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.canInstall).toBe(false);
  });

  it("needs the iPhone guide in Safari, and nothing once on the Home Screen", () => {
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
    device({ userAgent: iphone });
    expect(
      renderHook(() => useInstallPrompt(), { wrapper }).result.current,
    ).toMatchObject({
      needsIphoneGuide: true,
      standalone: false,
    });
    device({ userAgent: iphone, standalone: true });
    expect(
      renderHook(() => useInstallPrompt(), { wrapper }).result.current,
    ).toMatchObject({
      needsIphoneGuide: false,
      standalone: true,
    });
  });
});
