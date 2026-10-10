import Dexie, { type Table } from "dexie";
import { monthKey, todayISO } from "../lib/format";
import { buildMonthReport, type MonthReport } from "../lib/monthReport";

export type TxType = "expense" | "income";
export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

/** What a bracket's money actually does, independent of its name:
 *  - 'spend'      — capped discretionary/fixed spending (an "Expenditure"
 *                    bracket containing Rent, Food…). The sum of its
 *                    categories' `budget`s is a hard cap: this is the only
 *                    thing the Budget screen's ring, "Spent", and
 *                    "Remaining" figures are ever computed from.
 *  - 'allocation' — a transfer out of income toward a goal, not a spend
 *                    (Savings, Investments, EMI…). The sum of its
 *                    categories' `budget`s is a soft target (actual vs.
 *                    target), never counted against the spending cap.
 *  - 'income'     — a source of money in (an "Income" bracket containing
 *                    Salary, Freelance…). `budget` is meaningless/ignored
 *                    for these.
 *
 * There are 4 defaults (Expenditure/Savings/Investments/Income) seeded on
 * first install, but the user can add more brackets of any kind — e.g. a
 * separate "EMI" or "Work Expenses" bracket alongside the defaults.
 */
export type BracketKind = "spend" | "allocation" | "income";

/** The top level of the hierarchy: Expenditure, Savings, Investments,
 *  Income, or any custom bracket the user adds. A bracket's own total is
 *  always the sum of its categories' budgets — it never carries a budget
 *  of its own — so "does this bracket have sub-categories" is never a
 *  special case to code around: a bracket with exactly one category and a
 *  bracket with ten behave identically everywhere that reads the total. */
export interface Bracket {
  id?: number;
  name: string;
  icon: string;
  color: string;
  kind: BracketKind;
  archived?: boolean;
}

/** The sub-level: Rent/Food under an Expenditure bracket, Portfolio/Gold
 *  under an Investments bracket, Salary/Freelance under an Income bracket,
 *  or just one lone category under a bracket the user hasn't subdivided.
 *  Every category belongs to exactly one bracket, and inherits that
 *  bracket's kind for all behavior (capped vs. target vs. income) — a
 *  category never carries its own kind. */
export interface Category {
  id?: number;
  name: string;
  icon: string;
  color: string;
  budget: number;
  archived?: boolean;
  bracketId: number;
}

export interface Transaction {
  id?: number;
  type: TxType;
  amount: number;
  categoryId: number;
  date: string; // ISO yyyy-mm-dd
  merchant?: string;
  note?: string;
  paymentMethod?: string;
  tags?: string[];
  recurringId?: number;
  createdAt: number;
}

export interface Recurring {
  id?: number;
  name: string;
  type: TxType;
  amount: number;
  categoryId: number;
  frequency: Frequency;
  startDate: string; // ISO
  nextDate: string; // ISO — next date a transaction should be generated
  paused?: boolean;
  paymentMethod?: string;
  note?: string;
}

/** A friend's share of a split expense. The underlying Transaction (via
 *  `transactionId`) only ever records *your own* share of the cost — this
 *  is what makes the rest of the app (Dashboard, Analytics, every budget
 *  figure) completely unaware splitting exists at all, with zero special
 *  cases anywhere else. `personName` is a plain typed string, not a
 *  foreign key to a managed "people" list — there's no picker, just a
 *  text field with autocomplete suggested from names used before, so nothing
 *  needs a separate person-management screen for what's meant to be a
 *  lightweight IOU note, not a contacts system.
 *  `amountSettled` tracks a running total repaid (not a plain boolean) —
 *  real repayment between friends is often partial and dribbles in over
 *  time, not one clean lump sum. Settling never creates a Transaction and
 *  never touches any category's budget: the money was never counted as
 *  spent by you in the first place, so there's nothing to "give back". */
export interface SplitShare {
  id?: number;
  transactionId: number;
  personName: string;
  amountOwed: number;
  amountSettled: number;
  createdAt: number;
}

/** One point on a category's budget timeline. A closed month's report must
 *  show the cap that applied *then*, not whatever the budget is today, so
 *  every change to a category's effective budget (edit, archive, restore)
 *  is recorded here, keyed by the month it was made in.
 *  - A month's budget is the latest row with `month` <= that month.
 *  - `budget` is the *effective* cap: 0 while the category is archived.
 *  - `origin` tells the report how to treat months before the first row:
 *    'migrated' rows describe a category that already existed when tracking
 *    began (earlier months reuse its budget and are flagged approximate);
 *    'created' rows mean the category did not exist before `month`, so
 *    earlier months must not count its budget at all.
 *  Maintained by syncBudgetHistory(); never edited by hand. */
export type BudgetHistoryOrigin = "migrated" | "created" | "edited";
export interface BudgetHistoryEntry {
  id?: number;
  categoryId: number;
  month: string; // yyyy-mm — first month this budget applies to
  budget: number;
  origin: BudgetHistoryOrigin;
  createdAt: number;
}

export interface Settings {
  id?: number; // always 1
  onboarded: boolean;
  currency: string;
  theme: "dark" | "light" | "system";
  monthlyIncome: number;
  incomeSources?: string;
  carryForward: boolean;
  /** When true, the home-screen widget shows masked amounts ("•••• left")
   *  instead of real figures — the widget is glanceable on the lock screen
   *  or to anyone nearby, which is a real exposure for a private finance
   *  app that the in-app UI itself doesn't have. */
  hideWidgetAmounts?: boolean;
  /** When a full backup was last exported (ms). Backups are the only safety
   *  net — nothing syncs and Android auto-backup is off — so the app shows
   *  this and reminds when it gets stale. */
  lastBackupAt?: number;
  /** Hides the dashboard backup reminder until this time (ms). 0 = not snoozed. */
  backupNudgeSnoozedUntil?: number;
}

class MoneyMateDatabase extends Dexie {
  brackets!: Table<Bracket, number>;
  categories!: Table<Category, number>;
  transactions!: Table<Transaction, number>;
  recurring!: Table<Recurring, number>;
  settings!: Table<Settings, number>;
  splitShares!: Table<SplitShare, number>;
  budgetHistory!: Table<BudgetHistoryEntry, number>;

  constructor() {
    super("pfos_db");
    this.version(1).stores({
      categories: "++id, name, archived",
      transactions: "++id, type, categoryId, date, recurringId",
      recurring: "++id, categoryId, nextDate, paused",
      settings: "++id",
    });

    // v2: categories gain a type field (expense/income) so income transactions
    // stop being forced to pick from spending-budget categories. Existing
    // categories are backfilled as 'expense' — the only type they could have
    // meant before this field existed.
    this.version(2)
      .stores({
        categories: "++id, name, archived, type",
        transactions: "++id, type, categoryId, date, recurringId",
        recurring: "++id, categoryId, nextDate, paused",
        settings: "++id",
      })
      .upgrade((tx) => {
        return tx
          .table("categories")
          .toCollection()
          .modify((cat) => {
            if (!cat.type) cat.type = "expense";
          });
      });

    // v3: categories gain a `flow` field ('spend' | 'allocation' | 'income'),
    // replacing the old binary `type` ('expense' | 'income'). This is what
    // lets Savings/Investments/EMI be modeled as transfers-out-of-income
    // rather than capped spending categories, without hardcoding their names
    // anywhere — the user can flag any category as an allocation.
    // Backfill: 'income' carries straight over. The one existing category we
    // know was conceptually an allocation despite being seeded as 'expense'
    // is the default "Savings" category — reclassified by name match since
    // that's the only signal available for data written before this field
    // existed. Everything else becomes 'spend', preserving current behavior.
    this.version(3)
      .stores({
        categories: "++id, name, archived, flow",
        transactions: "++id, type, categoryId, date, recurringId",
        recurring: "++id, categoryId, nextDate, paused",
        settings: "++id",
      })
      .upgrade((tx) => {
        return tx
          .table("categories")
          .toCollection()
          .modify((cat) => {
            if (cat.type === "income") {
              cat.flow = "income";
            } else if (cat.name === "Savings") {
              cat.flow = "allocation";
            } else {
              cat.flow = "spend";
            }
            delete cat.type;
          });
      });

    // v4: introduces a real two-level hierarchy. Categories no longer carry
    // their own flat `flow` tag — they now belong to a `Bracket` (a new
    // table), and inherit that bracket's `kind` instead. This is what lets
    // Savings and Investments stop being flat leaf categories and become
    // their own brackets, each optionally subdivided further (Portfolio,
    // Gold, Stocks under Investments) exactly the way Expenditure already
    // subdivides into Rent/Food/etc — one consistent model instead of
    // Expenditure getting sub-categories for free while every other
    // allocation was stuck flat.
    //
    // Backfill: four brackets are created (Expenditure/spend,
    // Savings/allocation, Investments/allocation, Income/income) and every
    // existing category is assigned to one by its old `flow` — 'income'
    // categories go to Income, 'spend' categories go to Expenditure, and
    // 'allocation' categories go to Investments if the name suggests it
    // (the same "match on the only signal available" approach the v3
    // migration used for "Savings"), otherwise Savings.
    this.version(4)
      .stores({
        brackets: "++id, name, kind, archived",
        categories: "++id, name, archived, bracketId",
        transactions: "++id, type, categoryId, date, recurringId",
        recurring: "++id, categoryId, nextDate, paused",
        settings: "++id",
      })
      .upgrade(async (tx) => {
        const bracketsTable = tx.table("brackets");
        const expenditureId = await bracketsTable.add({
          name: "Expenditure",
          icon: "💳",
          color: "#7C93F0",
          kind: "spend",
        });
        const savingsId = await bracketsTable.add({
          name: "Savings",
          icon: "💰",
          color: "#4FD9B8",
          kind: "allocation",
        });
        const investmentsId = await bracketsTable.add({
          name: "Investments",
          icon: "📈",
          color: "#B98CF0",
          kind: "allocation",
        });
        const incomeId = await bracketsTable.add({
          name: "Income",
          icon: "💼",
          color: "#6FC98A",
          kind: "income",
        });

        await tx
          .table("categories")
          .toCollection()
          .modify((cat) => {
            if (cat.flow === "income") {
              cat.bracketId = incomeId;
            } else if (cat.flow === "allocation") {
              cat.bracketId = /invest/i.test(cat.name)
                ? investmentsId
                : savingsId;
            } else {
              cat.bracketId = expenditureId;
            }
            delete cat.flow;
          });
      });

    // v5: adds split-expense tracking (splitShares) — purely additive, no
    // existing table touched, nothing to backfill since the feature starts
    // empty for everyone. See the SplitShare interface's own comment for
    // why the underlying transaction only ever holds the user's own share.
    this.version(5).stores({
      brackets: "++id, name, kind, archived",
      categories: "++id, name, archived, bracketId",
      transactions: "++id, type, categoryId, date, recurringId",
      recurring: "++id, categoryId, nextDate, paused",
      settings: "++id",
      splitShares: "++id, transactionId, personName",
    });

    // v6: budgetHistory — per-category budget timeline so a closed month can
    // be reported against the cap that applied at the time. Existing
    // categories are seeded with their current effective budget as of this
    // month ('migrated': earlier months can only be approximated).
    this.version(6)
      .stores({
        brackets: "++id, name, kind, archived",
        categories: "++id, name, archived, bracketId",
        transactions: "++id, type, categoryId, date, recurringId",
        recurring: "++id, categoryId, nextDate, paused",
        settings: "++id",
        splitShares: "++id, transactionId, personName",
        budgetHistory: "++id, categoryId, month",
      })
      .upgrade(async (tx) => {
        const cats = await tx.table("categories").toArray();
        if (!cats.length) return;
        const month = monthKey(todayISO());
        await tx.table("budgetHistory").bulkAdd(
          cats.map((c: Category) => ({
            categoryId: c.id as number,
            month,
            budget: c.archived ? 0 : c.budget,
            origin: "migrated" as const,
            createdAt: Date.now(),
          })),
        );
      });
  }
}

export const db = new MoneyMateDatabase();

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get(1);
  if (existing) return existing;
  const defaults: Settings = {
    id: 1,
    onboarded: false,
    currency: "₹",
    theme: "dark",
    monthlyIncome: 0,
    carryForward: false,
    // Private by default: the home-screen widget masks balances until the
    // person opts in to showing them (Settings).
    hideWidgetAmounts: true,
  };
  await db.settings.put(defaults);
  return defaults;
}

export async function updateSettings(patch: Partial<Settings>) {
  const current = await getSettings();
  const next = { ...current, ...patch, id: 1 as number };
  await db.settings.put(next);
  return next;
}

/** Generates due recurring transactions since their nextDate, called once on app load. */
/** Generates due recurring transactions since their nextDate, called once on app load.
 *  Builds every new row in memory first, then commits with a single bulkAdd inside one
 *  Dexie transaction — a prior version awaited db.transactions.add() one row at a time,
 *  which meant a daily recurring item left unopened for weeks did dozens of sequential
 *  writes, each re-triggering every live query in the app. That's what caused a slow
 *  app launch; this version does one write and one live-query refresh regardless of
 *  how many days of backfill are needed. */
export async function processRecurring(todayISO: string) {
  const all = await db.recurring.toArray();
  const items = all.filter((r) => !r.paused);

  const newTransactions: Omit<Transaction, "id">[] = [];
  const recurringUpdates: { id: number; nextDate: string }[] = [];

  // Backstop against any single corrupted/imported recurring row (bad
  // frequency, bad date) hanging the whole app on every launch. advanceDate
  // already rejects unrecognized frequencies outright; this cap is a second,
  // independent line of defense against any other way the cursor could fail
  // to advance — 5000 iterations covers over a decade of daily backfill,
  // far more than any real recurring item would ever need.
  const MAX_BACKFILL_ITERATIONS = 5000;

  for (const item of items) {
    let cursor = item.nextDate;
    // Day-of-month the series started on — keeps month-end items (29th-31st)
    // from drifting after a short month. See advanceDate().
    const anchorDay = Number(String(item.startDate ?? "").slice(8, 10)) || undefined;
    // Staged per-item so a mid-loop throw (invalid frequency) can be
    // discarded cleanly — pushing straight into the shared newTransactions
    // array would leave a partial, bogus transaction committed for an item
    // that's supposed to be skipped entirely (caught by a test: the item's
    // *first* occurrence is generated before advanceDate() ever gets called
    // to produce the second one, so the throw happens one push too late to
    // prevent that first row from leaking through).
    const staged: Omit<Transaction, "id">[] = [];
    let generated = false;
    try {
      let iterations = 0;
      while (cursor <= todayISO) {
        if (++iterations > MAX_BACKFILL_ITERATIONS) {
          console.warn(
            `Recurring item ${item.id} ("${item.name}") exceeded the backfill cap — stopping early to avoid hanging the app. Check its data.`,
          );
          break;
        }
        staged.push({
          type: item.type,
          amount: item.amount,
          categoryId: item.categoryId,
          date: cursor,
          note: item.note ? item.note : `${item.name} (auto)`,
          merchant: item.name,
          paymentMethod: item.paymentMethod,
          recurringId: item.id,
          createdAt: Date.now(),
        });
        cursor = advanceDate(cursor, item.frequency, anchorDay);
        generated = true;
      }
    } catch (err) {
      // Most likely an invalid frequency from a malformed/imported backup.
      // Skip just this item rather than let one bad row take down recurring
      // processing (and therefore app launch) for everything else — `staged`
      // is discarded here, contributing nothing.
      console.warn(`Skipping recurring item ${item.id} — invalid data:`, err);
      continue;
    }
    newTransactions.push(...staged);
    if (generated) {
      recurringUpdates.push({ id: item.id!, nextDate: cursor });
    }
  }

  if (newTransactions.length === 0) return;

  await db.transaction("rw", db.transactions, db.recurring, async () => {
    await db.transactions.bulkAdd(newTransactions);
    for (const u of recurringUpdates) {
      await db.recurring.update(u.id, { nextDate: u.nextDate });
    }
  });
}

/** Last day of a 1-based month, computed in local time (no UTC round-trip). */
function daysInMonthOf(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Advances an ISO date by one `freq` step.
 *
 *  Monthly/yearly steps are anchored to `anchorDay` (the day-of-month the
 *  series started on) and clamped to the target month's length, so a rent
 *  item that starts on the 31st posts Jan 31 → Feb 28 → Mar 31 → Apr 30,
 *  instead of overflowing (Jan 31 → Mar 3) and staying on the 3rd. Without
 *  an anchor, the input date's own day is used (still clamped). */
export function advanceDate(
  iso: string,
  freq: Frequency,
  anchorDay?: number,
): string {
  const d = new Date(iso + "T00:00:00");
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "monthly" || freq === "yearly") {
    const wantDay =
      anchorDay && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : d.getDate();
    const total = d.getFullYear() * 12 + d.getMonth() + (freq === "monthly" ? 1 : 12);
    const y = Math.floor(total / 12);
    const m0 = total % 12;
    d.setFullYear(y, m0, Math.min(wantDay, daysInMonthOf(y, m0 + 1)));
  } else {
    // An unrecognized frequency (only reachable via a malformed/imported
    // recurring row, since the UI only ever offers the four values above)
    // must never fall through silently — returning `iso` unchanged here
    // would leave the while-loop in processRecurring() below stuck on the
    // same date forever, hanging the app on every future launch.
    throw new Error(`advanceDate: unrecognized frequency "${freq}"`);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The 4 default brackets, seeded once on first install (or by the v4
 *  migration for existing installs). The user can rename, archive, or add
 *  more brackets afterward — these are just the starting point. */
export const DEFAULT_BRACKETS: Omit<Bracket, "id">[] = [
  { name: "Expenditure", icon: "💳", color: "#7C93F0", kind: "spend" },
  { name: "Savings", icon: "💰", color: "#4FD9B8", kind: "allocation" },
  { name: "Investments", icon: "📈", color: "#B98CF0", kind: "allocation" },
  { name: "Income", icon: "💼", color: "#6FC98A", kind: "income" },
];

/** Seeds the 4 default brackets if none exist yet, and returns their ids
 *  keyed by name. Safe to call on every app boot — a no-op once brackets
 *  already exist, so it never duplicates or resets brackets the user has
 *  renamed, archived, or added to. */
export async function ensureDefaultBracketsSeeded(): Promise<
  Record<string, number>
> {
  const existing = await db.brackets.toArray();
  if (existing.length > 0) {
    const map: Record<string, number> = {};
    for (const b of existing) map[b.name] = b.id!;
    return map;
  }
  const map: Record<string, number> = {};
  for (const b of DEFAULT_BRACKETS) {
    map[b.name] = await db.brackets.add(b);
  }
  return map;
}

/** Starter categories for the Expenditure bracket, offered during
 *  onboarding. Investments and Savings deliberately start with no (or one
 *  generic) starter category rather than guessing sub-categories that
 *  wouldn't mean anything to most people — the user adds Portfolio/Gold/
 *  Stocks, or whatever they actually hold, once they visit that bracket. */
export const DEFAULT_EXPENDITURE_CATEGORIES: Omit<
  Category,
  "id" | "bracketId"
>[] = [
  { name: "Rent", icon: "🏠", color: "#F0B94D", budget: 0 },
  { name: "Food", icon: "🍲", color: "#6FC98A", budget: 0 },
  { name: "Transport", icon: "🚕", color: "#7C93F0", budget: 0 },
  { name: "Utilities", icon: "💡", color: "#F0A83E", budget: 0 },
  { name: "Shopping", icon: "🛍️", color: "#E8618C", budget: 0 },
  { name: "Entertainment", icon: "🎬", color: "#B98CF0", budget: 0 },
  { name: "Medical", icon: "⚕️", color: "#FF6B6B", budget: 0 },
];

/** Seeded the first time income tracking is turned on (monthlyIncome set
 *  above 0), so the Add Transaction income picker isn't empty. Budget is
 *  always 0 here since it's meaningless for income categories. */
export const DEFAULT_INCOME_CATEGORIES: Omit<Category, "id" | "bracketId">[] = [
  { name: "Salary", icon: "💼", color: "#4FD9B8", budget: 0 },
  { name: "Freelance", icon: "🧾", color: "#7C93F0", budget: 0 },
  { name: "Bonus", icon: "🎁", color: "#F0B94D", budget: 0 },
  { name: "Interest", icon: "📈", color: "#B98CF0", budget: 0 },
  { name: "Other Income", icon: "➕", color: "#6FC98A", budget: 0 },
];

/** Adds the default income categories to the Income bracket if it has none
 *  yet — called whenever income tracking transitions from off to on, so it
 *  never overwrites categories the user has already customized. */
export async function ensureIncomeCategoriesSeeded() {
  const brackets = await ensureDefaultBracketsSeeded();
  const incomeBracketId = brackets["Income"];
  const existing = await db.categories
    .where("bracketId")
    .equals(incomeBracketId)
    .count();
  if (existing === 0) {
    await db.categories.bulkAdd(
      DEFAULT_INCOME_CATEGORIES.map((c) => ({
        ...c,
        bracketId: incomeBracketId,
      })),
    );
  }
}

/** Brings budgetHistory in line with the categories' current effective
 *  budgets. Called whenever categories change (see BudgetHistoryKeeper in
 *  App.tsx) rather than from every write site, so no code path that edits a
 *  budget — BracketDetail, Onboarding, backup restore, catch-all shrinking —
 *  can forget to record it. Idempotent; `month` is injectable for tests.
 *  A change made twice in one month keeps only the month's final value. */
export async function syncBudgetHistory(
  month: string = monthKey(todayISO()),
): Promise<void> {
  await db.transaction("rw", db.categories, db.brackets, db.budgetHistory, async () => {
    const [cats, rows, brackets] = await Promise.all([
      db.categories.toArray(),
      db.budgetHistory.toArray(),
      db.brackets.toArray(),
    ]);
    const archivedBrackets = new Set(
      brackets.filter((b) => b.archived).map((b) => b.id),
    );
    const liveIds = new Set(cats.map((c) => c.id as number));

    // Rows for deleted categories are orphans — drop them.
    const orphanIds = rows.filter((r) => !liveIds.has(r.categoryId)).map((r) => r.id!);
    if (orphanIds.length) await db.budgetHistory.bulkDelete(orphanIds);

    const latest = new Map<number, BudgetHistoryEntry>();
    for (const r of rows) {
      if (!liveIds.has(r.categoryId)) continue;
      const cur = latest.get(r.categoryId);
      if (!cur || r.month > cur.month || (r.month === cur.month && (r.id ?? 0) > (cur.id ?? 0))) {
        latest.set(r.categoryId, r);
      }
    }

    const tableWasEmpty = rows.length === 0;
    for (const c of cats) {
      const id = c.id as number;
      // A category is effectively uncapped-to-zero once it, or the whole
      // bracket it lives in, is archived.
      const effective =
        c.archived || archivedBrackets.has(c.bracketId) ? 0 : c.budget;
      const last = latest.get(id);
      if (!last) {
        await db.budgetHistory.add({
          categoryId: id,
          month,
          budget: effective,
          origin: tableWasEmpty ? "migrated" : "created",
          createdAt: Date.now(),
        });
      } else if (last.budget !== effective) {
        if (last.month === month) {
          await db.budgetHistory.update(last.id!, { budget: effective });
        } else {
          await db.budgetHistory.add({
            categoryId: id,
            month,
            budget: effective,
            origin: "edited",
            createdAt: Date.now(),
          });
        }
      }
    }
  });
}

/** Loads everything the month report needs and builds it. This is the single
 *  entry point screens use for "how did month X go". */
export async function computeMonthReport(month: string): Promise<MonthReport> {
  const [brackets, categories, transactions, history] = await Promise.all([
    db.brackets.toArray(),
    db.categories.toArray(),
    db.transactions.where("date").startsWith(month).toArray(),
    db.budgetHistory.toArray(),
  ]);
  return buildMonthReport(month, {
    brackets,
    categories,
    transactions,
    history,
    today: todayISO(),
  });
}

/** Current month's spent/budget/remaining against the budget CAP only — the
 *  Budget screen's top line and the home-screen widget. Delegates to the
 *  month report so every screen shares one definition (see
 *  lib/monthReport.ts). */
export async function computeMonthSummary() {
  const month = monthKey(todayISO());
  const r = await computeMonthReport(month);
  return {
    spent: r.spent,
    budget: r.budgeted,
    remaining: r.remaining,
    monthKey: month,
  };
}
