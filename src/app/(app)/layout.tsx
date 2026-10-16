import { SerwistProvider } from "@serwist/turbopack/react";
import { NextIntlClientProvider } from "next-intl";
import { MotionProvider } from "@/components/motion/motion-provider";
import { InstallPromptProvider } from "@/components/providers/install-prompt-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { RegisterServiceWorker } from "@/components/providers/register-service-worker";
import { RemindersCheckIn } from "@/components/providers/reminders-check-in";
import { Toaster } from "@/components/ui/sonner";

/**
 * The app's pages (workspaces, invites, account, sign-in, the token pages): every message, data
 * fetching, motion, toasts, the install offer, the service worker and the reminders check-in. A
 * route group: the URLs don't change, and the public pages don't load any of this.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <NextIntlClientProvider>
      <QueryProvider>
        <InstallPromptProvider>
          {/* The service worker runs in production builds only (e2e uses one too). It caches
              nothing on its own while browsing and never reloads the page when the connection
              returns (a half-typed answer must survive). RegisterServiceWorker registers it, so a
              browser that refuses one isn't reported as a crash. */}
          <SerwistProvider
            swUrl="/serwist/sw.js"
            disable={process.env.NODE_ENV !== "production"}
            register={false}
            cacheOnNavigation={false}
            reloadOnOnline={false}
            options={{ scope: "/" }}
          >
            <RegisterServiceWorker />
            <MotionProvider>{children}</MotionProvider>
            <RemindersCheckIn />
          </SerwistProvider>
        </InstallPromptProvider>
        <Toaster />
      </QueryProvider>
    </NextIntlClientProvider>
  );
}
