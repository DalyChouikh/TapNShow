import { z } from "zod";
import { pushSubscriptionBodySchema } from "@/shared/api/push";

const payloadSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(300),
  url: z.string().regex(/^\/invites(\/[0-9a-f-]{36})?$/),
  tag: z.string().max(80),
});

/**
 * What to show for a push (spec §8). The worker always shows something: iOS takes the permission
 * away from a web app that receives a push and shows nothing. Only `/invites` links are opened.
 */
export function notificationFromPush(
  text: string | null,
  fallback: { title: string; body: string },
): { title: string; options: NotificationOptions } {
  let parsed: z.infer<typeof payloadSchema> | null = null;
  try {
    const result = payloadSchema.safeParse(text ? JSON.parse(text) : null);
    parsed = result.success ? result.data : null;
  } catch {
    parsed = null;
  }
  const base = { icon: "/icons/icon-192.png", badge: "/icons/badge-96.png" };
  return parsed
    ? {
        title: parsed.title,
        options: {
          body: parsed.body,
          tag: parsed.tag,
          ...base,
          data: { url: parsed.url },
        },
      }
    : {
        title: fallback.title,
        options: { body: fallback.body, ...base, data: { url: "/invites" } },
      };
}

/** An open TapNShow window (the part of `WindowClient` a tap needs). */
type WindowLike = {
  url: string;
  navigate?: (url: string) => Promise<object | null>;
  focus?: () => Promise<object>;
};

/**
 * The part of the worker's `clients` a tap needs. Structural, so this file type-checks with the
 * app's DOM types and tests pass plain objects; `self.clients` fits it.
 */
export type ClientsLike = {
  matchAll: (options: {
    type: "window";
    includeUncontrolled: boolean;
  }) => Promise<ReadonlyArray<WindowLike>>;
  openWindow: (url: string) => Promise<object | null>;
};

const onInvitesPage = (window: WindowLike) =>
  /^\/invites(\/|$)/.test(new URL(window.url).pathname);

/**
 * On a tap: reuse a window already showing invites (navigate and focus it), else open one. Other
 * pages are never taken over (an organizer may be editing there), and a window the worker can't
 * move (it doesn't control it) gets a new window instead, so a tap always opens the invite.
 */
export async function focusOrOpen(
  clients: ClientsLike,
  url: string,
): Promise<void> {
  const open = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const window = open.find(onInvitesPage);
  if (window?.navigate && window.focus) {
    try {
      await window.navigate(url);
      await window.focus();
      return;
    } catch {
      // Not this worker's window: open a new one below.
    }
  }
  await clients.openWindow(url);
}

/** A subscription as the worker sees it (structural, like `ClientsLike`). */
type SubscriptionLike = { toJSON: () => object };

/** The part of a `pushsubscriptionchange` event a re-subscribe needs. */
type SubscriptionChange = {
  oldSubscription: {
    options: { applicationServerKey: ArrayBuffer | null };
  } | null;
  newSubscription: SubscriptionLike | null;
};

/**
 * The browser replaced this device's subscription (spec §8): subscribe again with the same key
 * when it made no new one, and tell the server, so reminders keep arriving. The old endpoint is
 * forgotten when its push service answers "gone". Signed out, the server refuses and nothing
 * changes; the page's daily check-in (`checkInReminders`) covers browsers that never fire this.
 */
export async function resubscribe(
  change: SubscriptionChange,
  pushManager: {
    subscribe: (
      options: PushSubscriptionOptionsInit,
    ) => Promise<SubscriptionLike>;
  },
  send: (url: string, init: RequestInit) => Promise<Response>,
): Promise<void> {
  const key = change.oldSubscription?.options.applicationServerKey ?? null;
  const subscription =
    change.newSubscription ??
    (key
      ? await pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        })
      : null);
  const body = pushSubscriptionBodySchema.safeParse(subscription?.toJSON());
  if (!body.success) {
    return;
  }
  await send("/api/me/push-subscriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body.data),
  });
}

/**
 * A worker plugin for the saved invites: a list answered from this device's copy says so
 * (`saved: true`, see `myInvitesPageSchema`), so `/invites` shows its age and "Connect to answer"
 * even when the browser believes it is online. Anything that isn't a JSON object passes untouched.
 */
export function markSavedCopy() {
  return {
    cachedResponseWillBeUsed: async ({
      cachedResponse,
    }: {
      cachedResponse?: Response;
    }): Promise<Response | null> => {
      if (!cachedResponse) {
        return null;
      }
      const body = z.looseObject({}).safeParse(
        await cachedResponse
          .clone()
          .json()
          .catch(() => null),
      );
      if (!body.success) {
        return cachedResponse;
      }
      return new Response(JSON.stringify({ ...body.data, saved: true }), {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers: cachedResponse.headers,
      });
    },
  };
}

/**
 * A worker plugin for the saved invites: when the server says the session is gone (401), the saved
 * copy goes too, so a signed-out phone stops showing that person's invites offline.
 */
export function forgetWhenSignedOut(forget: () => Promise<void>) {
  return {
    fetchDidSucceed: async ({
      response,
    }: {
      response: Response;
    }): Promise<Response> => {
      if (response.status === 401) {
        await forget();
      }
      return response;
    },
  };
}
