import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { QueryProvider } from "@/components/providers/query-provider";
import { ApiClientError } from "@/lib/api-client";
import type { RemindersState } from "@/lib/push/client";
import { useReminders } from "./use-reminders";

const push = vi.hoisted(() => ({
  state: vi.fn<() => Promise<RemindersState>>(),
  on: vi.fn<() => Promise<RemindersState>>(),
  off: vi.fn<() => Promise<void>>(),
  toastError: vi.fn<(text: string) => void>(),
}));
vi.mock("@/lib/push/client", () => ({
  remindersState: push.state,
  turnOnReminders: push.on,
  turnOffReminders: push.off,
}));
vi.mock("sonner", () => ({ toast: { error: push.toastError } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <QueryProvider>{children}</QueryProvider>
  </NextIntlClientProvider>
);

beforeEach(() => vi.clearAllMocks());

describe("useReminders", () => {
  it("reads this device's state, then follows Turn on and Turn off", async () => {
    push.state.mockResolvedValueOnce("off");
    push.on.mockResolvedValueOnce("on");
    push.off.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useReminders(), { wrapper });
    expect(result.current.state).toBeNull();
    await waitFor(() => expect(result.current.state).toBe("off"));
    act(() => result.current.turnOn());
    await waitFor(() => expect(result.current.state).toBe("on"));
    expect(result.current.justTurnedOn).toBe(true);
    act(() => result.current.turnOff());
    await waitFor(() => expect(result.current.state).toBe("off"));
  });

  it("keeps the state and says why when turning on fails", async () => {
    push.state.mockResolvedValueOnce("off");
    push.on.mockRejectedValueOnce(new ApiClientError("rate_limited", 429));
    const { result } = renderHook(() => useReminders(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("off"));
    act(() => result.current.turnOn());
    await waitFor(() =>
      expect(push.toastError).toHaveBeenCalledWith(
        messages.ApiErrors.rate_limited,
      ),
    );
    expect(result.current.state).toBe("off");
  });

  it("treats a device it can't read as unsupported", async () => {
    push.state.mockRejectedValueOnce(new Error("SecurityError"));
    const { result } = renderHook(() => useReminders(), { wrapper });
    await waitFor(() => expect(result.current.state).toBe("unsupported"));
  });
});
