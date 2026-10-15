/// <reference lib="esnext" />
/// <reference lib="webworker" />
// First: Zod must be jitless before the handlers below parse anything.
import "@/lib/zod-jitless";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
} from "serwist";
import {
  OFFLINE_INVITES_MAX_AGE_SECONDS,
  OFFLINE_PAGES,
  OFFLINE_PAGES_MAX_ENTRIES,
  SW_CACHES,
  SW_NETWORK_TIMEOUT_SECONDS,
} from "@/config/offline";
import {
  focusOrOpen,
  forgetWhenSignedOut,
  markSavedCopy,
  notificationFromPush,
  resubscribe,
} from "@/lib/push/sw-handlers";
import messages from "../../messages/en.json";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const isMemberPage = (pathname: string) =>
  OFFLINE_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  );

// Only these are cached (spec §10 PWA): the shell's hashed files, the member pages, and the
// invites list. Answer pages, every other API call and every write always go to the network.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request, sameOrigin, url }) =>
        sameOrigin && request.mode === "navigate" && isMemberPage(url.pathname),
      handler: new NetworkFirst({
        cacheName: SW_CACHES.pages,
        networkTimeoutSeconds: SW_NETWORK_TIMEOUT_SECONDS,
        plugins: [
          new ExpirationPlugin({ maxEntries: OFFLINE_PAGES_MAX_ENTRIES }),
        ],
      }),
    },
    {
      matcher: ({ request, sameOrigin, url }) =>
        sameOrigin &&
        request.method === "GET" &&
        url.pathname === "/api/me/invites",
      handler: new NetworkFirst({
        cacheName: SW_CACHES.invites,
        networkTimeoutSeconds: SW_NETWORK_TIMEOUT_SECONDS,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 20,
            maxAgeSeconds: OFFLINE_INVITES_MAX_AGE_SECONDS,
          }),
          forgetWhenSignedOut(async () => {
            await caches.delete(SW_CACHES.invites);
          }),
          // After the expiration check, so only a copy still in date is marked and shown.
          markSavedCopy(),
        ],
      }),
    },
    {
      // Every other page: never saved, but routed through the worker so an offline visit gets
      // the offline page instead of the browser's error.
      matcher: ({ request, sameOrigin }) =>
        sameOrigin && request.mode === "navigate",
      handler: new NetworkOnly(),
    },
    {
      // Fonts stay with the browser's own cache (hashed, immutable, served offline too): a font the
      // page preloads and the worker also answers is fetched twice, and Chrome warns that the
      // preload went unused.
      matcher: ({ request, sameOrigin, url }) =>
        sameOrigin &&
        request.destination !== "font" &&
        url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: SW_CACHES.static,
        plugins: [new ExpirationPlugin({ maxEntries: 300 })],
      }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

self.addEventListener("push", (event) => {
  const { title, options } = notificationFromPush(event.data?.text() ?? null, {
    title: messages.Notifications.fallbackTitle,
    body: messages.Notifications.fallbackBody,
  });
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data: { url?: string } = event.notification.data ?? {};
  event.waitUntil(focusOrOpen(self.clients, data.url ?? "/invites"));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    resubscribe(event, self.registration.pushManager, (url, init) =>
      fetch(url, init),
    ).catch(() => undefined),
  );
});

serwist.addEventListeners();
