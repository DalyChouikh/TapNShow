"use client";

import { useCallback, useEffect, useState } from "react";

/** Whether this browser can keep an element's width current. */
const canObserve = () => typeof ResizeObserver !== "undefined";

/**
 * An element's content width, kept current with a ResizeObserver: `[ref, width]`. Measured once
 * as the element attaches (during the commit, so before the browser paints: a layout that depends
 * on it never flashes its unmeasured form), then on every resize. The width is null until
 * measured, and wherever the browser can't measure.
 */
export function useElementWidth<T extends HTMLElement>(): [
  (element: T | null) => void,
  number | null,
] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((node: T | null) => {
    setElement(node);
    if (node && canObserve()) {
      setWidth(node.getBoundingClientRect().width);
    }
  }, []);
  useEffect(() => {
    if (!element || !canObserve()) {
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
