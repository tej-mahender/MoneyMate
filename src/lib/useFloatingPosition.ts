import { useLayoutEffect, useState, type RefObject } from "react";

export interface FloatingPosition {
  top: number;
  left: number;
  width: number;
}

/**
 * Tracks the on-screen position of `anchorRef` while `open` is true, so a
 * portaled panel (rendered into document.body) can be pinned directly under
 * it. Recomputes on scroll/resize since the trigger can move under a fixed
 * panel. Using a portal + viewport coordinates sidesteps ancestor stacking
 * contexts entirely (e.g. cards using backdrop-filter, which otherwise trap
 * a popover's z-index inside that card and let later sibling cards paint
 * over it).
 */
/**
 * Tracks the on-screen position of `anchorRef` while `open` is true, so a
 * portaled panel (rendered into document.body) can be pinned directly under
 * it. Recomputes on scroll/resize since the trigger can move under a fixed
 * panel. Using a portal + viewport coordinates sidesteps ancestor stacking
 * contexts entirely (e.g. cards using backdrop-filter, which otherwise trap
 * a popover's z-index inside that card and let later sibling cards paint
 * over it).
 *
 * `panelWidth`, if given, is used to clamp `left` so a fixed-width panel
 * (e.g. the icon picker) never overflows past the right edge of the
 * viewport. Omit it for panels that simply match the anchor's own width
 * (e.g. the select dropdown), which can't overflow since the anchor itself
 * already fits on screen.
 */
export function useFloatingPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  panelWidth?: number,
): FloatingPosition | null {
  const [pos, setPos] = useState<FloatingPosition | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = panelWidth ?? rect.width;
      const maxLeft = window.innerWidth - width - 8;
      const left = Math.min(rect.left, Math.max(8, maxLeft));
      setPos({ top: rect.bottom + 8, left, width: rect.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef, panelWidth]);

  return pos;
}
