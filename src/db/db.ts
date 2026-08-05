import Dexie, { type Table } from "dexie";
import { monthKey, todayISO } from "../lib/format";

export type TxType = "expense" | "income";
export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export interface Category {
  id?: number;
  name: string;
  icon: string;
  color: string;
  budget: number;
  archived?: boolean;
  /** Which transaction type this category applies to. Defaults to 'expense'
   *  for backward compatibility with categories created before this field
   *  existed. Income categories (Salary, Freelance, etc.) don't have a
   *  meaningful "budget" — it's ignored/hidden for them in the UI. */
  type?: TxType;
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
}

class PFOSDatabase extends Dexie {
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
  }
}

export const db = new PFOSDatabase();

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

  for (const item of items) {
    let cursor = item.nextDate;
    let generated = false;
    while (cursor <= todayISO) {
      newTransactions.push({
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const DEFAULT_CATEGORIES: Omit<Category, "id">[] = [
  { name: "Rent", icon: "🏠", color: "#F0B94D", budget: 0, type: "expense" },
  { name: "Food", icon: "🍲", color: "#6FC98A", budget: 0, type: "expense" },
  {
    name: "Transport",
    icon: "🚕",
    color: "#7C93F0",
    budget: 0,
    type: "expense",
  },
  {
    name: "Utilities",
    icon: "💡",
    color: "#F0A83E",
    budget: 0,
    type: "expense",
  },
  {
    name: "Shopping",
    icon: "🛍️",
    color: "#E8618C",
    budget: 0,
    type: "expense",
  },
  {
    name: "Entertainment",
    icon: "🎬",
    color: "#B98CF0",
    budget: 0,
    type: "expense",
  },
  { name: "Medical", icon: "⚕️", color: "#FF6B6B", budget: 0, type: "expense" },
  { name: "Savings", icon: "💰", color: "#4FD9B8", budget: 0, type: "expense" },
];

/** Seeded the first time income tracking is turned on (monthlyIncome set
 *  above 0), so the Add Transaction income picker isn't empty. Budget is
 *  always 0 here since it's meaningless for income categories. */
export const DEFAULT_INCOME_CATEGORIES: Omit<Category, "id">[] = [
  { name: "Salary", icon: "💼", color: "#4FD9B8", budget: 0, type: "income" },
  {
    name: "Freelance",
    icon: "🧾",
    color: "#7C93F0",
    budget: 0,
    type: "income",
  },
  { name: "Bonus", icon: "🎁", color: "#F0B94D", budget: 0, type: "income" },
  { name: "Interest", icon: "📈", color: "#B98CF0", budget: 0, type: "income" },
  {
    name: "Other Income",
    icon: "➕",
    color: "#6FC98A",
    budget: 0,
    type: "income",
  },
];

/** Adds the default income categories if none exist yet — called whenever
 *  income tracking transitions from off to on, so it never overwrites
 *  categories the user has already customized. */
export async function ensureIncomeCategoriesSeeded() {
  const existing = await db.categories.where("type").equals("income").count();
  if (existing === 0) {
    await db.categories.bulkAdd(DEFAULT_INCOME_CATEGORIES);
  }
}

/** Current month's spent/budget/remaining — the same figures Dashboard shows.
 *  Factored out so the quick-add widget popup (which never renders Dashboard)
 *  can push an accurate widget refresh after saving, without duplicating this
 *  logic and risking it drifting out of sync with the real dashboard math. */
export async function computeMonthSummary() {
  const curMonth = monthKey(todayISO());
  const [categories, transactions] = await Promise.all([
    db.categories.toArray(),
    db.transactions.where("date").startsWith(curMonth).toArray(),
  ]);
  const totalBudget = categories
    .filter((c) => c.type !== "income")
    .reduce((s, c) => s + c.budget, 0);
  const totalSpent = transactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  return {
    spent: totalSpent,
    budget: totalBudget,
    remaining: totalBudget - totalSpent,
    monthKey: curMonth,
  };
}
