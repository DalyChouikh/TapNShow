import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";

type Fixtures = {
  /**
   * Console messages this test provokes on purpose (for example a 404 it asks for), as one pattern
   * (`/a|b/`): Playwright reads a two-item array option as `[value, options]`.
   */
  allowConsole: RegExp | null;
  /** Fails the test on any browser console error or warning or uncaught error (spec §12, M9). */
  browserConsole: void;
};

/**
 * Every e2e spec imports `test` from here (ESLint enforces it). The guard watches the test's own
 * context and every context the test opens with `browser.newContext()`, including their pages
 * opened later (popups, new tabs). CSP violations reach it as console errors.
 */
export const test = base.extend<Fixtures>({
  allowConsole: [null, { option: true }],
  browserConsole: [
    async ({ browser, context, allowConsole }, use) => {
      const problems: string[] = [];
      const watchPage = (page: Page) => {
        page.on("console", (message) => {
          const type = message.type();
          if (type !== "error" && type !== "warning") {
            return;
          }
          // A failed resource's own URL is the message's location, not part of its text.
          const source = message.location().url;
          const text = source
            ? `${message.text()} <${source}>`
            : message.text();
          if (!allowConsole?.test(text)) {
            problems.push(`${type}: ${text} (${page.url()})`);
          }
        });
        page.on("pageerror", (error) => {
          problems.push(`uncaught: ${error.message} (${page.url()})`);
        });
      };
      const watchContext = async (watched: BrowserContext) => {
        // Report-only violations still fire this event; the console guard then fails the test.
        await watched.addInitScript(() => {
          document.addEventListener("securitypolicyviolation", (event) => {
            // Runs in the page: the browser console is the channel this guard reads.
            // eslint-disable-next-line no-console
            console.error(
              `CSP ${event.disposition}: ${event.effectiveDirective} blocked ${event.blockedURI || "inline"} at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`,
            );
          });
        });
        watched.pages().forEach(watchPage);
        watched.on("page", watchPage);
      };
      await watchContext(context);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const created = await newContext(options);
        await watchContext(created);
        return created;
      };
      try {
        await use();
      } finally {
        browser.newContext = newContext;
      }
      expect(problems, "browser console errors and warnings").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
