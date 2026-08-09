import { registerPlugin, Capacitor } from '@capacitor/core';

export interface WidgetSnapshot {
  spent: number;
  budget: number;
  remaining: number;
  currency: string;
  monthLabel: string;
  /** Mirrors Settings.hideWidgetAmounts — the native widget masks its text
   *  when this is true rather than deciding privacy on its own. */
  hideAmounts: boolean;
}

interface WidgetBridgePlugin {
  updateWidget(options: WidgetSnapshot): Promise<{ ok: boolean }>;
  /** Reads (and clears) a pending in-app route the native side stashed —
   *  currently just the widget's "+" button asking to land straight on
   *  /add instead of the dashboard. Returns { route: null } normally. */
  getPendingRoute(): Promise<{ route: string | null }>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

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
    console.warn('Widget sync failed', err);
  }
}

/**
 * Checks whether the app was just launched via the widget's "+" button
 * asking for a specific route (currently only "/add"). Safe to call on
 * every app boot — a no-op returning null in the browser/PWA. The native
 * side clears its stored value as it reads it, so this only fires once per
 * tap rather than re-triggering on every subsequent cold start.
 */
export async function consumePendingWidgetRoute(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { route } = await WidgetBridge.getPendingRoute();
    return route || null;
  } catch (err) {
    console.warn('Reading pending widget route failed', err);
    return null;
  }
}
