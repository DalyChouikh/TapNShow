"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { palette, shape } from "@/design/tokens";
import messages from "../../messages/en.json";

const { light, dark } = palette;

/**
 * The root layout (and its stylesheet) is gone when this renders, so the page carries its own
 * minimal styles from the design tokens, following the system color scheme (#51).
 */
const GLOBAL_ERROR_CSS = `
body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
  padding: 16px; box-sizing: border-box; font-family: system-ui, sans-serif;
  background: ${light.background}; color: ${light.ink}; }
main { display: flex; flex-direction: column; gap: 16px; max-width: 28rem; padding: 20px;
  background: ${light.surface}; border: ${shape.borderWidth} solid ${light.outline};
  border-radius: ${shape.radiusCard}; box-shadow: 0 ${shape.shadow} 0 ${light.outline}; }
p { margin: 0; font-size: 16px; line-height: 1.5; }
button { min-height: 44px; padding: 0 16px; font: inherit; font-weight: 700; cursor: pointer;
  color: ${light.onFill}; background: ${light.primary};
  border: ${shape.borderWidth} solid ${light.outline}; border-radius: ${shape.radiusControl}; }
@media (prefers-color-scheme: dark) {
  body { background: ${dark.background}; color: ${dark.ink}; }
  main { background: ${dark.surface}; border-color: ${dark.outline}; box-shadow: 0 ${shape.shadow} 0 ${dark.outline}; }
  button { color: ${dark.onFill}; background: ${dark.primary}; border-color: ${dark.outline}; }
}
`;

/** Last-resort error boundary; reports to Sentry and offers a retry. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <style>{GLOBAL_ERROR_CSS}</style>
      </head>
      <body>
        <main>
          <p>{messages.Errors.global}</p>
          <button type="button" onClick={() => reset()}>
            {messages.Errors.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
