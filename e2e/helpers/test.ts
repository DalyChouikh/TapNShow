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
 * opened later (popups, new tabs). CSP reports reach it as console errors (Task 5).
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
          const text = message.text();
          if (!allowConsole?.test(text)) {
            problems.push(`${type}: ${text} (${page.url()})`);
          }
        });
        page.on("pageerror", (error) => {
          problems.push(`uncaught: ${error.message} (${page.url()})`);
        });
      };
      const watchContext = (watched: BrowserContext) => {
        watched.pages().forEach(watchPage);
        watched.on("page", watchPage);
      };
      watchContext(context);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const created = await newContext(options);
        watchContext(created);
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
