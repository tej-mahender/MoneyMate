import type {
  Bracket,
  BudgetHistoryEntry,
  Category,
  Transaction,
} from "../db/db";
import { monthKey } from "./format";
import { progressState } from "./budgetLogic";

/** The single definition of "how did a month go" against the budget cap.
 *  Pure — no database access — so every screen (Budget, the widget, any
 *  future month review) is guaranteed to agree, and it's trivially testable.
 *  db.ts's computeMonthReport() is the loader that feeds it.
 *
 *  Scope rules (identical to what the Budget screen has always meant):
 *  - Capped spend = categories in 'spend' brackets. Archiving a category or
 *    a whole bracket zeroes its cap from that month on (see budgetHistory),
 *    but earlier months keep reporting it — archiving never rewrites the past.
 *  - Spent counts every expense in those categories, archived ones
 *    included (money spent is spent); allocation transfers (Savings,
 *    Investments…) are never spend; uncategorized transactions are reported
 *    separately and not counted against the cap.
 *  - Budget per category comes from the budget timeline for past months, so
 *    editing a cap later never rewrites a closed month. The current (and any
 *    future) month always uses the live category values. */

export type RowStatus = "good" | "warn" | "over" | "unbudgeted";

export interface CategoryReportRow {
  categoryId: number;
  name: string;
  icon: string;
  color: string;
  budget: number;
  spent: number;
  /** budget - spent: positive = under the cap, negative = over it. */
  variance: number;
  /** spent / budget as a percentage; 0 when there is no budget. */
  pct: number;
  status: RowStatus;
  archived: boolean;
}

export interface AllocationReportRow {
  categoryId: number;
  name: string;
  icon: string;
  color: string;
  target: number;
  actual: number;
  archived: boolean;
}

export interface MonthReport {
  month: string;
  isCurrent: boolean;
  /** True when the month predates budget tracking, so its caps are
   *  reconstructed from the earliest known budget and may not be exact. */
  approximate: boolean;
  budgeted: number;
  spent: number;
  remaining: number;
  usedPct: number;
  verdict: "under" | "over" | "on";
  income: number;
  rows: CategoryReportRow[];
  overCount: number;
  /** Spend in capped categories that have no budget set for the month. */
  unbudgetedSpent: number;
  allocations: AllocationReportRow[];
  /** Expenses pointing at a deleted category — shown, not capped. */
  uncategorizedSpent: number;
}

export interface MonthReportInput {
  brackets: Bracket[];
  categories: Category[];
  /** Any superset of the month's transactions is fine; others are ignored. */
  transactions: Transaction[];
  history: BudgetHistoryEntry[];
  /** yyyy-mm-dd — decides which months count as current. */
  today: string;
}

/** The cap that applied to `cat` in `month`. */
export function budgetForMonth(
  cat: Category,
  month: string,
  history: BudgetHistoryEntry[],
  currentMonth: string,
  bracketArchived = false,
): number {
  const live = cat.archived || bracketArchived ? 0 : cat.budget;
  if (month >= currentMonth) return live;
  const rows = history
    .filter((h) => h.categoryId === cat.id)
    .sort((a, b) => (a.month === b.month ? (a.id ?? 0) - (b.id ?? 0) : a.month < b.month ? -1 : 1));
  if (rows.length === 0) return live;
  let applicable: BudgetHistoryEntry | undefined;
  for (const r of rows) if (r.month <= month) applicable = r;
  if (applicable) return applicable.budget;
  // Month predates the first row.
  return rows[0].origin === "created" ? 0 : rows[0].budget;
}

export function buildMonthReport(
  month: string,
  input: MonthReportInput,
): MonthReport {
  const { brackets, categories, history, today } = input;
  const currentMonth = monthKey(today);
  const isCurrent = month === currentMonth;
  const tx = input.transactions.filter((t) => monthKey(t.date) === month);

  const spendBracketIds = new Set(
    brackets.filter((b) => b.kind === "spend").map((b) => b.id),
  );
  const archivedBracketIds = new Set(
    brackets.filter((b) => b.archived).map((b) => b.id),
  );
  const allocationBracketIds = new Set(
    brackets.filter((b) => b.kind === "allocation").map((b) => b.id),
  );
  const knownCategoryIds = new Set(categories.map((c) => c.id));

  const spentBy = new Map<number, number>();
  let income = 0;
  let uncategorizedSpent = 0;
  for (const t of tx) {
    if (t.type === "income") {
      income += t.amount;
      continue;
    }
    spentBy.set(t.categoryId, (spentBy.get(t.categoryId) ?? 0) + t.amount);
    if (!knownCategoryIds.has(t.categoryId)) uncategorizedSpent += t.amount;
  }

  const trackedSince = history.reduce(
    (min, h) => (h.month < min ? h.month : min),
    currentMonth,
  );
  const approximate = month < trackedSince;

  const rows: CategoryReportRow[] = [];
  const allocations: AllocationReportRow[] = [];
  for (const c of categories) {
    const id = c.id as number;
    const spent = spentBy.get(id) ?? 0;
    const budget = budgetForMonth(
      c,
      month,
      history,
      currentMonth,
      archivedBracketIds.has(c.bracketId),
    );
    if (spendBracketIds.has(c.bracketId)) {
      // A category with neither a cap nor spending that month is noise.
      if (budget === 0 && spent === 0) continue;
      const pct = budget > 0 ? (spent / budget) * 100 : 0;
      const status: RowStatus =
        budget <= 0 ? "unbudgeted" : progressState(pct, false);
      rows.push({
        categoryId: id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        budget,
        spent,
        variance: budget - spent,
        pct,
        status,
        archived: !!c.archived,
      });
    } else if (allocationBracketIds.has(c.bracketId)) {
      if (budget === 0 && spent === 0) continue;
      allocations.push({
        categoryId: id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        target: budget,
        actual: spent,
        archived: !!c.archived,
      });
    }
  }
  rows.sort((a, b) => b.spent - a.spent || b.budget - a.budget);
  allocations.sort((a, b) => b.actual - a.actual || b.target - a.target);

  const budgeted = rows.reduce((s, r) => s + r.budget, 0);
  const spent = rows.reduce((s, r) => s + r.spent, 0);
  const remaining = budgeted - spent;
  return {
    month,
    isCurrent,
    approximate,
    budgeted,
    spent,
    remaining,
    usedPct: budgeted > 0 ? (spent / budgeted) * 100 : 0,
    verdict: spent > budgeted ? "over" : spent === budgeted ? "on" : "under",
    income,
    rows,
    // Strictly over the cap: spending exactly the budget is not an overrun.
    overCount: rows.filter((r) => r.budget > 0 && r.spent > r.budget).length,
    unbudgetedSpent: rows
      .filter((r) => r.status === "unbudgeted")
      .reduce((s, r) => s + r.spent, 0),
    allocations,
    uncategorizedSpent,
  };
}
