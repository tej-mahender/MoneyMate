import { useEffect, useRef } from "react";
import { useUIStore } from "../store/useUIStore";
import { AlertTriangle } from "lucide-react";

/**
 * A custom in-app confirmation dialog that replaces native `window.confirm()`.
 * Renders as a glassmorphism modal overlay with smooth enter/exit animations,
 * matching the existing MoneyMate design language (cards, backdrop blur,
 * brand colors).
 *
 * Mount this once alongside `<Toast />` in App.tsx — the dialog reads its
 * state from useUIStore, the same way Toast does.
 */
export default function ConfirmDialog() {
  const dialog = useUIStore((s) => s.confirmDialog);
  const resolveConfirm = useUIStore((s) => s.resolveConfirm);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the confirm button when the dialog appears, so keyboard
  // users can immediately hit Enter/Space. Also traps Escape to dismiss.
  useEffect(() => {
    if (!dialog) return;
    // Small delay to let the entrance animation start before focusing
    // (prevents the focus ring from appearing at the wrong position).
    const timer = setTimeout(() => confirmRef.current?.focus(), 80);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        resolveConfirm(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dialog, resolveConfirm]);

  // Lock background scroll while open
  useEffect(() => {
    if (dialog) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [dialog]);

  if (!dialog) return null;

  const {
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
  } = dialog;

  return (
    <div className="confirm-overlay" onClick={() => resolveConfirm(false)}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`confirm-icon-wrap${danger ? " danger" : ""}`}>
          <AlertTriangle size={22} />
        </div>
        <h3 id="confirm-title" className="confirm-title">
          {title}
        </h3>
        <p id="confirm-message" className="confirm-message">
          {message}
        </p>
        <div className="confirm-actions">
          <button
            className="btn secondary confirm-btn"
            onClick={() => resolveConfirm(false)}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={`btn confirm-btn${danger ? " danger" : ""}`}
            onClick={() => resolveConfirm(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
