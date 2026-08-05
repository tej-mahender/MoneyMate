import { registerPlugin, Capacitor } from "@capacitor/core";

export interface WidgetSnapshot {
  spent: number;
  budget: number;
  remaining: number;
  currency: string;
  monthLabel: string;
}

interface WidgetBridgePlugin {
  updateWidget(options: WidgetSnapshot): Promise<{ ok: boolean }>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge");

/**
 * Pushes the current month's totals to the native home-screen widget.
 * Safe to call on every dashboard render — it's a no-op in the browser/PWA
 * and only does anything inside the Capacitor Android wrapper.
 */
export async function syncWidget(snapshot: WidgetSnapshot): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WidgetBridge.updateWidget(snapshot);
  } catch (err) {
    // Widget sync is best-effort — never let it break the dashboard.
    console.warn("Widget sync failed", err);
  }
}
