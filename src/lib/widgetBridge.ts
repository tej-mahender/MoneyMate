import { registerPlugin, Capacitor } from "@capacitor/core";

/** One row in the large widget's mini category breakdown. Kept intentionally
 *  small (name/icon/color + two numbers) since it's serialized to a JSON
 *  string on the native side and rendered into a fixed number of rows. */
export interface WidgetCategorySnapshot {
  name: string;
  icon: string;
  color: string;
  spent: number;
  budget: number;
}

export interface WidgetSnapshot {
  spent: number;
  budget: number;
  remaining: number;
  currency: string;
  monthLabel: string;
  /** Mirrors Settings.hideWidgetAmounts — the native widget masks its text
   *  when this is true rather than deciding privacy on its own. */
  hideAmounts: boolean;
  /** Top categories by spend this month, for the larger 4x2 widget variant.
   *  Optional — the small widget ignores it entirely. Cap at ~4 before
   *  passing in; the native side also caps defensively. */
  categories?: WidgetCategorySnapshot[];
}

interface WidgetBridgePlugin {
  updateWidget(options: WidgetSnapshot): Promise<{ ok: boolean }>;
  /** Reads (and clears) a pending in-app route the native side stashed —
   *  currently just the widget's "+" button asking to land straight on
   *  /add instead of Home. Returns { route: null } normally. */
  getPendingRoute(): Promise<{ route: string | null }>;
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge");

/** In-app routes a widget tap may open. Today that's only the "+" button. */
const ALLOWED_WIDGET_ROUTES = new Set(["/add"]);

/**
 * Pushes the current month's totals to the native home-screen widget.
 * Safe to call on every Budget-screen render — it's a no-op in the browser/PWA
 * and only does anything inside the Capacitor Android wrapper.
 */
export async function syncWidget(snapshot: WidgetSnapshot): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WidgetBridge.updateWidget(snapshot);
  } catch (err) {
    // Widget sync is best-effort — never let it break the Budget screen.
    console.warn("Widget sync failed", err);
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
    // The native side stores whatever route an incoming intent carries, and
    // MainActivity is exported — so only routes the widget itself can ask
    // for are honoured; anything else is dropped.
    return route && ALLOWED_WIDGET_ROUTES.has(route) ? route : null;
  } catch (err) {
    console.warn("Reading pending widget route failed", err);
    return null;
  }
}
