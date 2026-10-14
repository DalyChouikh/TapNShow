import { z } from "zod";

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

/** A window the worker controls (the part of `WindowClient` a tap needs). */
type WindowLike = {
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

/** On a tap: reuse an open TapNShow window (navigate and focus it), else open one. */
export async function focusOrOpen(
  clients: ClientsLike,
  url: string,
): Promise<void> {
  const open = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const window = open.find((client) => client.navigate && client.focus);
  if (window?.navigate && window.focus) {
    await window.navigate(url);
    await window.focus();
    return;
  }
  await clients.openWindow(url);
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
