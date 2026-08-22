import { useLayoutEffect, useState, type RefObject } from "react";

export interface FloatingPosition {
  top: number;
  left: number;
  width: number;
}

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
