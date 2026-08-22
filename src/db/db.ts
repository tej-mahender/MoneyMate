import Dexie, { type Table } from "dexie";
import { monthKey, todayISO } from "../lib/format";

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
}

class MoneyMateDatabase extends Dexie {
  brackets!: Table<Bracket, number>;
  categories!: Table<Category, number>;
  transactions!: Table<Transaction, number>;
  recurring!: Table<Recurring, number>;
  settings!: Table<Settings, number>;

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
    hideWidgetAmounts: false,
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
        cursor = advanceDate(cursor, item.frequency);
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

export function advanceDate(iso: string, freq: Frequency): string {
  const d = new Date(iso + "T00:00:00");
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  else {
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

/** Current month's spent/budget/remaining against the budget CAP only — the
 *  same figures the Budget screen shows, and in fact the literal source of
 *  them (Dashboard renders this function's output directly rather than
 *  keeping its own copy of the same math). Aggregates every category whose
 *  bracket is kind 'spend' (usually just Expenditure, but not assumed to be
 *  the only one — a custom second spend-kind bracket rolls in too).
 *  Deliberately excludes 'allocation' brackets (Savings, Investments,
 *  EMI…): those are transfers out of income, tracked separately on Home,
 *  not spend against a cap. Uses an indexed date-range query rather than
 *  pulling the whole transactions table into memory, so cost scales with
 *  "days in this month" rather than total history — see
 *  src/test/performance.test.tsx for the regression guard on that. */
export async function computeMonthSummary() {
  const curMonth = monthKey(todayISO());
  const [brackets, categories, transactions] = await Promise.all([
    db.brackets.toArray(),
    db.categories.toArray(),
    db.transactions.where("date").startsWith(curMonth).toArray(),
  ]);
  const spendBracketIds = new Set(
    brackets.filter((b) => b.kind === "spend" && !b.archived).map((b) => b.id),
  );
  const spendCategoryIds = new Set(
    categories.filter((c) => spendBracketIds.has(c.bracketId)).map((c) => c.id),
  );
  const totalBudget = categories
    .filter((c) => spendCategoryIds.has(c.id) && !c.archived)
    .reduce((s, c) => s + c.budget, 0);
  const totalSpent = transactions
    .filter((t) => t.type === "expense" && spendCategoryIds.has(t.categoryId))
    .reduce((s, t) => s + t.amount, 0);
  return {
    spent: totalSpent,
    budget: totalBudget,
    remaining: totalBudget - totalSpent,
    monthKey: curMonth,
  };
}
