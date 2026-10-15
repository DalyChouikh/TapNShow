import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { InstallPromptProvider } from "./install-prompt-provider";

const wrapper = ({ children }: { children: ReactNode }) => (
  <InstallPromptProvider>{children}</InstallPromptProvider>
);

function installPrompt() {
  const prompt = vi.fn<() => Promise<void>>(async () => undefined);
  const event = Object.assign(new Event("beforeinstallprompt"), {
    prompt,
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
  });
  return { event, prompt };
}

describe("useInstallPrompt", () => {
  it("offers Install once the browser allows it, and prompts once", async () => {
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
    const { result } = renderHook(() => useInstallPrompt(), { wrapper });
    act(() => {
      window.dispatchEvent(installPrompt().event);
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.canInstall).toBe(false);
  });
});
