import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useFloatingPosition } from "../lib/useFloatingPosition";

export interface DropdownOption {
  value: string;
  label: string;
}

export default function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select…",
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const typeaheadRef = useRef({ buffer: "", lastKeyTime: 0 });
  const pos = useFloatingPosition(triggerRef, open);

  function close(refocusTrigger: boolean) {
    setOpen(false);
    if (refocusTrigger) triggerRef.current?.focus();
  }

  function selectAt(index: number) {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    close(true);
  }

  function focusOptionAt(index: number) {
    const clamped = Math.max(0, Math.min(options.length - 1, index));
    optionRefs.current[clamped]?.focus();
  }

  // Native <select>-style type-ahead: typing a letter jumps to the next
  // option whose label starts with it, cycling from the currently focused
  // one; a short pause resets the buffer instead of matching multi-letter
  // strings forever.
  function handleTypeahead(e: React.KeyboardEvent, currentIndex: number) {
    if (e.key.length !== 1 || e.altKey || e.ctrlKey || e.metaKey) return false;
    const now = Date.now();
    const state = typeaheadRef.current;
    state.buffer = now - state.lastKeyTime > 600 ? e.key : state.buffer + e.key;
    state.lastKeyTime = now;
    const needle = state.buffer.toLowerCase();
    const n = options.length;
    for (let step = 1; step <= n; step++) {
      const idx = (currentIndex + step) % n;
      if (options[idx].label.toLowerCase().startsWith(needle)) {
        focusOptionAt(idx);
        return true;
      }
    }
    return false;
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
    }
  }

  function handleOptionKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusOptionAt(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusOptionAt(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusOptionAt(0);
        break;
      case "End":
        e.preventDefault();
        focusOptionAt(options.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        // Don't trap focus — let Tab leave the panel normally, just close it.
        setOpen(false);
        break;
      default:
        handleTypeahead(e, index);
    }
  }

  // Move focus onto the currently-selected option (or the first one) the
  // moment the panel opens, so arrow keys work immediately without an extra
  // Tab press — this is what makes the dropdown behave like a native
  // <select> for keyboard/screen-reader users instead of only a mouse target.
  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    );
    // Wait a tick for the portal content to actually mount.
    const raf = requestAnimationFrame(() => focusOptionAt(selectedIndex));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="dropdown-wrap" ref={wrapRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <ChevronDown
          size={16}
          style={{
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform .15s",
            flexShrink: 0,
            color: "var(--ink-faint)",
          }}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panelRef}
              className="dropdown-panel"
              role="listbox"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {options.map((o, i) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={
                      "dropdown-option" + (isSelected ? " selected" : "")
                    }
                    onClick={() => selectAt(i)}
                    onKeyDown={(e) => handleOptionKeyDown(e, i)}
                  >
                    <span>{o.label}</span>
                    {isSelected && (
                      <Check size={15} className="dropdown-check" />
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
