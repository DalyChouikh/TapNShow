"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * An element's content width, kept current with a ResizeObserver: `[ref, width]`. The width is
 * null until measured, and wherever the browser can't measure.
 */
export function useElementWidth<T extends HTMLElement>(): [
  (element: T | null) => void,
  number | null,
] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [ref, width];
}
