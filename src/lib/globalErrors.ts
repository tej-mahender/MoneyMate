import { useUIStore } from "../store/useUIStore";

/** Last-resort net for promise rejections nothing else caught (an
 *  un-awaited write that fails, a storage error in an event handler).
 *  React's ErrorBoundary only sees render errors, so without this a failed
 *  async write is completely silent. Logged locally and surfaced as a short
 *  toast; nothing is ever sent anywhere. */
export function installGlobalErrorHandlers(): () => void {
  let lastShown = 0;
  const onRejection = (e: PromiseRejectionEvent) => {
    console.error("Unhandled rejection:", e.reason);
    const now = Date.now();
    if (now - lastShown < 3000) return; // don't stack toasts
    lastShown = now;
    useUIStore.getState().showToast("Something went wrong. Please try again.");
  };
  window.addEventListener("unhandledrejection", onRejection);
  return () => window.removeEventListener("unhandledrejection", onRejection);
}
