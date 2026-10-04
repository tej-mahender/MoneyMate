import { Capacitor } from "@capacitor/core";
import { liveQuery } from "dexie";
import { db, computeMonthReport } from "../db/db";
import { monthKey, monthLabel, todayISO } from "./format";
import {
  syncWidget,
  type WidgetCategorySnapshot,
  type WidgetSnapshot,
} from "./widgetBridge";

// Keeps the Android home-screen widget in step with the database from ONE
// place, instead of only when the Budget screen happens to render.
//
// startWidgetSync() subscribes to a Dexie live query over everything the
// snapshot reads, so any write (add / edit / delete a transaction, restore a
// backup, change a budget or a setting) re-computes the snapshot and pushes
// it. A visibility listener also refreshes when the app returns to the
// foreground, which picks up a month rollover that happened while it was
// backgrounded.

const EMPTY_SNAPSHOT: WidgetSnapshot = {
  spent: 0,
  budget: 0,
  remaining: 0,
  currency: "₹",
  monthLabel: "",
  hideAmounts: true,
  categories: [],
};

let lastPushed = "";

function push(snapshot: WidgetSnapshot): void {
  const key = JSON.stringify(snapshot);
  if (key === lastPushed) return; // nothing changed, skip the native call
  lastPushed = key;
  void syncWidget(snapshot);
}

/** Computes what the widget should currently show. Read-only (safe to run
 *  inside a Dexie live query) and uses the same month report as the Budget
 *  screen, so the widget and the app always agree. */
export async function buildWidgetSnapshot(): Promise<WidgetSnapshot> {
  const month = monthKey(todayISO());
  const [report, settings, brackets, categories, monthTx] = await Promise.all([
    computeMonthReport(month),
    db.settings.get(1),
    db.brackets.toArray(),
    db.categories.toArray(),
    db.transactions.where("date").startsWith(month).toArray(),
  ]);

  const spendBracketIds = new Set(
    brackets.filter((b) => b.kind === "spend" && !b.archived).map((b) => b.id),
  );
  const allocationBracketIds = new Set(
    brackets.filter((b) => b.kind === "allocation").map((b) => b.id),
  );
  const allocationCategoryIds = new Set(
    categories
      .filter((c) => allocationBracketIds.has(c.bracketId))
      .map((c) => c.id),
  );
  const spendCategories = categories.filter(
    (c) => !c.archived && spendBracketIds.has(c.bracketId),
  );

  const spentByCategory = new Map<number, number>();
  for (const t of monthTx) {
    if (t.type !== "expense") continue;
    if (t.categoryId == null || allocationCategoryIds.has(t.categoryId)) continue;
    spentByCategory.set(
      t.categoryId,
      (spentByCategory.get(t.categoryId) ?? 0) + t.amount,
    );
  }
  const top: WidgetCategorySnapshot[] = spendCategories
    .map((c) => ({
      name: c.name,
      icon: c.icon,
      color: c.color,
      spent: spentByCategory.get(c.id!) ?? 0,
      budget: c.budget,
    }))
    .filter((c) => c.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 4);

  return {
    spent: report.spent,
    budget: report.budgeted,
    remaining: report.remaining,
    currency: settings?.currency ?? "₹",
    monthLabel: monthLabel(month),
    hideAmounts: settings ? !!settings.hideWidgetAmounts : true,
    categories: top,
  };
}

/** Starts keeping the widget in sync. No-op outside the Android wrapper.
 *  Returns a function that stops it. */
export function startWidgetSync(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  const subscription = liveQuery(buildWidgetSnapshot).subscribe({
    next: push,
    error: (err) => console.warn("Widget sync query failed", err),
  });

  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    buildWidgetSnapshot()
      .then(push)
      .catch((err) => console.warn("Widget refresh failed", err));
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    subscription.unsubscribe();
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Blanks the widget (zero totals, no category names). Used by "Erase all
 *  data": the widget keeps its own copy of the numbers in native storage, so
 *  clearing the database alone would leave the old balances on the home
 *  screen. Always pushes, even if the last snapshot looks identical. */
export async function clearWidget(): Promise<void> {
  lastPushed = JSON.stringify(EMPTY_SNAPSHOT);
  await syncWidget(EMPTY_SNAPSHOT);
}
