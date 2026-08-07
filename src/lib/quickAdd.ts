declare global {
  interface Window {
    /** Injected only inside QuickAddActivity's WebView (Android) — a raw
     *  @JavascriptInterface bridge, not the Capacitor plugin system, since
     *  this popup is a second, lightweight WebView rather than the main
     *  Capacitor-bridged app instance. Absent everywhere else (web/PWA,
     *  and the normal in-app screens), so every call here is guarded. */
    AndroidQuickAdd?: {
      close: () => void;
      syncWidget: (json: string) => void;
    };
  }
}

export function isQuickAddContext(): boolean {
  return typeof window !== "undefined" && !!window.AndroidQuickAdd;
}

export function closeQuickAdd() {
  window.AndroidQuickAdd?.close();
}

export function pushQuickWidgetSync(data: {
  spent: number;
  budget: number;
  remaining: number;
  currency: string;
  monthLabel: string;
}) {
  window.AndroidQuickAdd?.syncWidget(JSON.stringify(data));
}

export {};
