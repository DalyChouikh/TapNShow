import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  key: ("B" + "A".repeat(86)) as string | undefined,
}));
vi.mock("@/config/public-env", () => ({
  publicEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    get NEXT_PUBLIC_VAPID_PUBLIC_KEY() {
      return env.key;
    },
  },
}));

const redirect = vi.hoisted(() => ({ toLogin: vi.fn<() => void>() }));
vi.mock("@/lib/auth-redirect", () => ({ redirectToLogin: redirect.toLogin }));

const { checkInReminders, remindersState, turnOffReminders, turnOnReminders } =
  await import("./client");

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

type FakeSubscription = {
  endpoint: string;
  toJSON: () => object;
  unsubscribe: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
};

function fakeSubscription(): FakeSubscription {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
    }),
    unsubscribe: vi.fn<() => Promise<boolean>>(async () => true),
  };
}

/** One device: browser, permission, existing subscription, standalone mode. */
function device(
  options: {
    userAgent?: string;
    permission?: NotificationPermission;
    answer?: NotificationPermission;
    subscription?: FakeSubscription | null;
    standalone?: boolean;
    push?: boolean;
  } = {},
) {
  const subscription = options.subscription ?? null;
  const fresh = fakeSubscription();
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn<
      (options: PushSubscriptionOptionsInit) => Promise<FakeSubscription>
    >(async () => fresh),
  };
  const registration = { pushManager };
  vi.stubGlobal("navigator", {
    userAgent: options.userAgent ?? ANDROID,
    maxTouchPoints: 5,
    serviceWorker: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(async () => registration),
    },
  });
  if (options.push !== false) {
    vi.stubGlobal("PushManager", function PushManager() {});
  }
  vi.stubGlobal("Notification", {
    permission: options.permission ?? "default",
    requestPermission: vi.fn(async () => options.answer ?? "granted"),
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: options.standalone ?? false })),
  );
  return { pushManager, fresh };
}

function stubFetch(status = 200) {
  const fetchMock = vi.fn<
    (url: string, init: RequestInit) => Promise<Response>
  >(
    async () =>
      new Response(
        JSON.stringify(
          status === 200
            ? { ok: true }
            : { error: { code: "rate_limited", message: "x" } },
        ),
        { status },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  env.key = `B${"A".repeat(86)}`;
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "PushManager");
});

describe("remindersState (spec §7.4)", () => {
  it("is unavailable without the public key", async () => {
    env.key = undefined;
    device();
    expect(await remindersState()).toBe("unavailable");
  });

  it("asks iPhones to install first, unless opened from the Home Screen", async () => {
    device({ userAgent: IPHONE });
    expect(await remindersState()).toBe("needs_install");
    device({ userAgent: IPHONE, standalone: true });
    expect(await remindersState()).toBe("off");
  });

  it("is unsupported without Web Push", async () => {
    device({ push: false });
    expect(await remindersState()).toBe("unsupported");
  });

  it("is blocked, on or off from the permission and the subscription", async () => {
    device({ permission: "denied" });
    expect(await remindersState()).toBe("blocked");
    device({ permission: "granted", subscription: fakeSubscription() });
    expect(await remindersState()).toBe("on");
    device({ permission: "granted" });
    expect(await remindersState()).toBe("off");
  });
});

describe("turnOnReminders", () => {
  it("asks, subscribes visibly with the key's bytes and tells the server", async () => {
    const { pushManager, fresh } = device();
    const fetchMock = stubFetch();
    expect(await turnOnReminders()).toBe("on");
    const [options] = pushManager.subscribe.mock.calls[0];
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toHaveLength(65);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/me/push-subscriptions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
    });
    expect(fresh.unsubscribe).not.toHaveBeenCalled();
  });

  it("undoes the browser subscription when the server refuses", async () => {
    const { fresh } = device();
    stubFetch(429);
    await expect(turnOnReminders()).rejects.toThrow();
    expect(fresh.unsubscribe).toHaveBeenCalledOnce();
  });

  it("subscribes nothing when the person says no", async () => {
    const { pushManager } = device({ answer: "denied" });
    expect(await turnOnReminders()).toBe("blocked");
    device({ answer: "default" });
    expect(await turnOnReminders()).toBe("off");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe("turnOffReminders", () => {
  it("tells the server, then unsubscribes the browser", async () => {
    const subscription = fakeSubscription();
    device({ permission: "granted", subscription });
    const fetchMock = stubFetch();
    await turnOffReminders();
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      endpoint: ENDPOINT,
    });
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("still unsubscribes when the server call fails (already signed out)", async () => {
    const subscription = fakeSubscription();
    device({ permission: "granted", subscription });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    await turnOffReminders();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("never sends the person to sign-in when the session is already gone (account deleted)", async () => {
    const subscription = fakeSubscription();
    device({ permission: "granted", subscription });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "unauthenticated", message: "x" },
            }),
            { status: 401 },
          ),
      ),
    );
    await turnOffReminders();
    expect(redirect.toLogin).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does nothing without a subscription", async () => {
    device();
    const fetchMock = stubFetch();
    await turnOffReminders();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkInReminders (spec §8: a device that checks in is not idle)", () => {
  const HOUR_MS = 3_600_000;
  const start = new Date("2026-10-14T08:00:00Z");
  const later = (hours: number) => new Date(start.getTime() + hours * HOUR_MS);

  it("re-sends this device's subscription at most once a day", async () => {
    device({ permission: "granted", subscription: fakeSubscription() });
    const fetchMock = stubFetch();
    await checkInReminders(start);
    await checkInReminders(later(1));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/me/push-subscriptions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) },
    });
    await checkInReminders(later(25));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends nothing while reminders are off on this device", async () => {
    device({ permission: "granted" });
    const fetchMock = stubFetch();
    await checkInReminders(start);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tries again at the next visit after a failure, and never sends anyone to sign-in", async () => {
    device({ permission: "granted", subscription: fakeSubscription() });
    stubFetch(401);
    await checkInReminders(start);
    expect(redirect.toLogin).not.toHaveBeenCalled();
    const fetchMock = stubFetch();
    await checkInReminders(later(1));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("counts turning on as a check-in", async () => {
    const { fresh } = device();
    stubFetch();
    await turnOnReminders(start);
    device({ permission: "granted", subscription: fresh });
    const fetchMock = stubFetch();
    await checkInReminders(later(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
