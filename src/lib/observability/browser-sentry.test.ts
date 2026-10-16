import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BrowserSentry,
  createBrowserSentry,
  EARLY_ERRORS_MAX,
} from "./browser-sentry";

/** A fake SDK and a loader the test resolves or rejects by hand. */
function fakeSdk() {
  const sdk = {
    captureException: vi.fn<BrowserSentry["captureException"]>(),
    captureRouterTransitionStart:
      vi.fn<BrowserSentry["captureRouterTransitionStart"]>(),
  };
  let resolve: (value: BrowserSentry) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const load = vi.fn<() => Promise<BrowserSentry>>(
    () =>
      new Promise<BrowserSentry>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return {
    sdk,
    load,
    resolve: () => resolve(sdk),
    reject: () => reject(new Error("chunk failed")),
  };
}

function dispatchWindowError(error: Error) {
  window.dispatchEvent(
    new ErrorEvent("error", { error, message: error.message }),
  );
}

function dispatchRejection(reason: Error) {
  const event = new Event("unhandledrejection");
  Object.assign(event, { reason });
  window.dispatchEvent(event);
}

describe("createBrowserSentry", () => {
  afterEach(() => vi.useRealTimers());

  it("loads the SDK only after the page has loaded, when the browser is idle", async () => {
    vi.useFakeTimers();
    const { load } = fakeSdk();
    createBrowserSentry().start({ enabled: true, load });
    expect(load).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(load).toHaveBeenCalledOnce();
  });

  it("waits for the load event when the document is still loading", async () => {
    vi.useFakeTimers();
    const readyState = vi
      .spyOn(document, "readyState", "get")
      .mockReturnValue("loading");
    const { load } = fakeSdk();
    createBrowserSentry().start({ enabled: true, load });
    await vi.runAllTimersAsync();
    expect(load).not.toHaveBeenCalled();
    readyState.mockRestore();
    window.dispatchEvent(new Event("load"));
    await vi.runAllTimersAsync();
    expect(load).toHaveBeenCalledOnce();
  });

  it("reports errors captured before the SDK loaded, in order, once it is ready", async () => {
    const { sdk, load, resolve } = fakeSdk();
    const sentry = createBrowserSentry();
    sentry.start({ enabled: true, load });
    const boundary = new Error("render failed");
    const thrown = new Error("thrown early");
    const rejected = new Error("rejected early");
    sentry.captureError(boundary);
    dispatchWindowError(thrown);
    dispatchRejection(rejected);
    expect(sdk.captureException).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    resolve();
    await vi.waitFor(() =>
      expect(sdk.captureException.mock.calls).toEqual([
        [boundary],
        [thrown],
        [rejected],
      ]),
    );
  });

  it("hands errors straight to the SDK once ready, and stops listening (Sentry's own handlers take over)", async () => {
    const { sdk, load, resolve } = fakeSdk();
    const sentry = createBrowserSentry();
    sentry.start({ enabled: true, load });
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    resolve();
    await vi.waitFor(() => expect(sentry.isReady()).toBe(true));
    const later = new Error("later");
    sentry.captureError(later);
    dispatchWindowError(new Error("window, after ready"));
    expect(sdk.captureException.mock.calls).toEqual([[later]]);
    expect(sentry.bufferedCount()).toBe(0);
  });

  it(`keeps only the first ${EARLY_ERRORS_MAX} early errors (the first is usually the cause)`, async () => {
    const { sdk, load, resolve } = fakeSdk();
    const sentry = createBrowserSentry();
    sentry.start({ enabled: true, load });
    const errors = Array.from(
      { length: EARLY_ERRORS_MAX + 5 },
      (_, index) => new Error(`e${index}`),
    );
    for (const error of errors) sentry.captureError(error);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    resolve();
    await vi.waitFor(() => expect(sentry.isReady()).toBe(true));
    expect(sdk.captureException.mock.calls).toEqual(
      errors.slice(0, EARLY_ERRORS_MAX).map((error) => [error]),
    );
  });

  it("drops the buffer and stops listening when the SDK can't load (blocked or offline)", async () => {
    const { sdk, load, reject } = fakeSdk();
    const sentry = createBrowserSentry();
    sentry.start({ enabled: true, load });
    sentry.captureError(new Error("before"));
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    reject();
    await vi.waitFor(() => expect(sentry.isOff()).toBe(true));
    sentry.captureError(new Error("after"));
    dispatchWindowError(new Error("window, after failure"));
    expect(sentry.bufferedCount()).toBe(0);
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("downloads nothing and buffers nothing when Sentry is off (no DSN)", async () => {
    vi.useFakeTimers();
    const { load } = fakeSdk();
    const sentry = createBrowserSentry();
    sentry.start({ enabled: false, load });
    sentry.captureError(new Error("x"));
    dispatchWindowError(new Error("y"));
    await vi.runAllTimersAsync();
    expect(load).not.toHaveBeenCalled();
    expect(sentry.bufferedCount()).toBe(0);
  });

  it("starts once: a second start neither loads twice nor doubles the listeners", async () => {
    const { sdk, load, resolve } = fakeSdk();
    const sentry = createBrowserSentry();
    sentry.start({ enabled: true, load });
    sentry.start({ enabled: true, load });
    dispatchWindowError(new Error("once"));
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    resolve();
    await vi.waitFor(() => expect(sentry.isReady()).toBe(true));
    expect(load).toHaveBeenCalledOnce();
    expect(sdk.captureException).toHaveBeenCalledOnce();
  });

  it("traces navigations only once the SDK is ready (none are queued)", async () => {
    const { sdk, load, resolve } = fakeSdk();
    const sentry = createBrowserSentry();
    sentry.start({ enabled: true, load });
    sentry.onRouterTransitionStart("/privacy", "push");
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    resolve();
    await vi.waitFor(() => expect(sentry.isReady()).toBe(true));
    expect(sdk.captureRouterTransitionStart).not.toHaveBeenCalled();
    sentry.onRouterTransitionStart("/terms", "push");
    expect(sdk.captureRouterTransitionStart).toHaveBeenCalledExactlyOnceWith(
      "/terms",
      "push",
    );
  });
});
