import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EMOJI_OPTIONS } from "../lib/emojiOptions";

export default function IconPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
  palette,
}: {
  icon: string;
  color: string;
  onIconChange: (icon: string) => void;
  onColorChange: (color: string) => void;
  palette: string[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // pointerdown (not click) so this fires before any click-through side effects,
    // and capture phase so it still closes even if a descendant stops propagation
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div style={{ position: "relative" }} ref={wrapRef}>
      <button
        type="button"
        className="swatch"
        style={{
          background: color + "33",
          color,
          cursor: "pointer",
          border: open ? "1.5px solid var(--gold)" : undefined,
        }}
        onClick={() => setOpen((v) => !v)}
        aria-label="Choose icon and color"
      >
        {icon}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="icon-picker-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="icon-picker-colors">
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="icon-picker-color-dot"
                  style={{
                    background: c,
                    outline: c === color ? "2px solid var(--gold)" : "none",
                    outlineOffset: 2,
                  }}
                  onClick={() => onColorChange(c)}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>

            <div className="icon-picker-grid">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={
                    "icon-picker-emoji" + (e === icon ? " selected" : "")
                  }
                  onClick={() => {
                    onIconChange(e);
                    setOpen(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Or type/paste any emoji…"
              value=""
              onChange={(e) => {
                const val = e.target.value.trim();
                if (val) onIconChange(Array.from(val)[0]);
              }}
              style={{ marginTop: 4 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
