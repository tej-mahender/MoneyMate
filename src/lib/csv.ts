import Papa from "papaparse";
import {
  db,
  type Category,
  type Transaction,
  type Recurring,
  type Settings,
} from "../db/db";
import { monthKey, weekdayName, isWeekend, quarterOf, isoWeek } from "./format";

export const SCHEMA_VERSION = 3;

/** Prevents CSV formula injection: a cell starting with =, +, -, or @ gets
 *  interpreted as a formula by Excel/Sheets when the file is opened. Prefixing
 *  with a leading apostrophe forces it to be read as literal text instead. */
function sanitizeCsvCell(v: string): string {
  if (/^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

async function loadAll() {
  const [transactions, categories, recurring, settings] = await Promise.all([
    db.transactions.toArray(),
    db.categories.toArray(),
    db.recurring.toArray(),
    db.settings.toArray(),
  ]);
  return { transactions, categories, recurring, settings };
}

/** Flat, ML/BI-ready transaction records: one row per transaction with every
 *  date feature a model or Power BI pivot would otherwise have to recompute. */
function enrichedTransactionRows(
  transactions: Transaction[],
  categories: Category[],
) {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  let running = 0;
  return transactions
    .slice()
    .sort((a, b) =>
      a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1,
    )
    .map((t) => {
      running += t.type === "income" ? t.amount : -t.amount;
      const cat = catMap.get(t.categoryId);
      return {
        Date: t.date,
        Year: Number(t.date.slice(0, 4)),
        Quarter: quarterOf(t.date),
        Month: monthKey(t.date),
        Week: isoWeek(t.date),
        Weekday: weekdayName(t.date),
        IsWeekend: isWeekend(t.date),
        CategoryId: t.categoryId,
        Category: sanitizeCsvCell(cat?.name || "Uncategorized"),
        Merchant: sanitizeCsvCell(t.merchant || ""),
        PaymentMethod: t.paymentMethod || "",
        Amount: t.amount,
        Type: t.type,
        RunningBalance: Math.round(running * 100) / 100,
        IsRecurring: Boolean(t.recurringId),
        Notes: sanitizeCsvCell(t.note || ""),
        Tags: sanitizeCsvCell((t.tags || []).join("|")),
      };
    });
}

export async function exportTransactionsCSV(): Promise<string> {
  const { transactions, categories } = await loadAll();
  return Papa.unparse(enrichedTransactionRows(transactions, categories));
}

/** Dimension table — pairs with the transactions fact table in Power BI via CategoryId. */
export async function exportCategoriesCSV(): Promise<string> {
  const { categories } = await loadAll();
  const rows = categories.map((c) => ({
    CategoryId: c.id,
    Name: sanitizeCsvCell(c.name),
    Type: c.type ?? "expense",
    Icon: c.icon,
    Color: c.color,
    MonthlyBudget: c.budget,
    Archived: Boolean(c.archived),
  }));
  return Papa.unparse(rows);
}

/** Pre-aggregated month x category fact table — the natural grain for a Power BI
 *  budget-vs-actual report without needing measures computed in DAX. */
export async function exportMonthlySummaryCSV(): Promise<string> {
  const { transactions, categories } = await loadAll();
  const months = Array.from(
    new Set(transactions.map((t) => monthKey(t.date))),
  ).sort();
  const rows: Record<string, string | number | null>[] = [];
  for (const m of months) {
    for (const c of categories) {
      const actual = transactions
        .filter(
          (t) =>
            t.type === "expense" &&
            t.categoryId === c.id &&
            monthKey(t.date) === m,
        )
        .reduce((s, t) => s + t.amount, 0);
      if (actual === 0 && c.budget === 0) continue;
      rows.push({
        Month: m,
        CategoryId: c.id ?? -1,
        CategoryName: sanitizeCsvCell(c.name),
        Budget: c.budget,
        Actual: Math.round(actual * 100) / 100,
        Variance: Math.round((c.budget - actual) * 100) / 100,
        PctOfBudget:
          c.budget > 0 ? Math.round((actual / c.budget) * 1000) / 10 : null,
      });
    }
  }
  return Papa.unparse(rows);
}

/** A single bundled JSON dataset — transactions (enriched), categories, and the
 *  monthly summary — sized for a Python/pandas ML notebook to load in one shot
 *  (`pd.json_normalize(data['transactions'])`) without juggling three CSV files. */
export async function exportMLDatasetJSON(): Promise<string> {
  const { transactions, categories, recurring, settings } = await loadAll();
  const s = settings[0];
  const months = Array.from(
    new Set(transactions.map((t) => monthKey(t.date))),
  ).sort();
  const monthlySummary = months.flatMap((m) =>
    categories.map((c) => {
      const actual = transactions
        .filter(
          (t) =>
            t.type === "expense" &&
            t.categoryId === c.id &&
            monthKey(t.date) === m,
        )
        .reduce((s2, t) => s2 + t.amount, 0);
      return {
        month: m,
        categoryId: c.id,
        categoryName: c.name,
        budget: c.budget,
        actual: Math.round(actual * 100) / 100,
        variance: Math.round((c.budget - actual) * 100) / 100,
      };
    }),
  );
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      currency: s?.currency || "₹",
      transactions: enrichedTransactionRows(transactions, categories),
      categories,
      recurring,
      monthlySummary,
    },
    null,
    2,
  );
}

export async function exportFullBackup(): Promise<string> {
  const { categories, transactions, recurring, settings } = await loadAll();
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      categories,
      transactions,
      recurring,
      settings,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}

export async function importFullBackup(json: string) {
  const data = JSON.parse(json);
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.transactions)
  ) {
    throw new Error("Invalid backup file");
  }

  // A backup written by a newer app version might use a data shape this
  // version doesn't understand yet — refuse rather than silently importing
  // something that could half-apply and leave the DB in a weird state.
  if (
    typeof data.schemaVersion === "number" &&
    data.schemaVersion > SCHEMA_VERSION
  ) {
    throw new Error(
      "This backup was created with a newer version of Money Mate. Please update the app before restoring it.",
    );
  }

  // Generous sanity cap — not a real-world size any real backup would hit,
  // just a guard against a corrupted/hostile file freezing the tab on import.
  const MAX_RECORDS = 200_000;
  if (
    data.categories.length > MAX_RECORDS ||
    data.transactions.length > MAX_RECORDS ||
    (Array.isArray(data.recurring) && data.recurring.length > MAX_RECORDS)
  ) {
    throw new Error("Backup file is too large to import.");
  }

  const categories = sanitizeCategories(data.categories);
  const transactions = sanitizeTransactions(data.transactions);
  const recurring = sanitizeRecurring(
    Array.isArray(data.recurring) ? data.recurring : [],
  );

  await db.transaction(
    "rw",
    db.categories,
    db.transactions,
    db.recurring,
    db.settings,
    async () => {
      await db.categories.clear();
      await db.transactions.clear();
      await db.recurring.clear();
      await db.settings.clear();
      if (categories.length)
        await db.categories.bulkAdd(stripIds<Category>(categories));
      if (transactions.length)
        await db.transactions.bulkAdd(stripIds<Transaction>(transactions));
      if (recurring.length)
        await db.recurring.bulkAdd(stripIds<Recurring>(recurring));
      if (Array.isArray(data.settings) && data.settings.length) {
        await db.settings.bulkAdd(sanitizeSettings(data.settings));
      }
    },
  );
}

// --- Import validation -----------------------------------------------------
// A restored backup is untrusted input the moment it could have come from
// anywhere other than this app's own export (a file shared by someone else,
// a hand-edited file, a corrupted download). Every field gets coerced to a
// safe, well-typed value rather than trusted as-is:
//  - numeric fields that aren't finite numbers would otherwise silently
//    propagate NaN through every budget/spend calculation in the app;
//  - `color` is written straight into an inline style elsewhere in the app,
//    so it's constrained to a strict hex-color shape rather than accepted
//    as an arbitrary string;
//  - `frequency` is constrained to the four values the UI can ever produce —
//    an unrecognized one would otherwise hang the app forever the next time
//    recurring transactions are processed (see advanceDate in db.ts).
// Records are sanitized in place (never dropped/reordered) so the position-
// based id remapping in stripIds()/bulkAdd() stays aligned: categories keep
// their relative order so a transaction's categoryId still points at the
// right row after both tables are re-inserted with fresh auto-increment ids.

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
const MAX_TEXT_LEN = 200;
const MAX_ICON_LEN = 8; // generous enough for multi-codepoint emoji (ZWJ sequences, skin tones)
const FALLBACK_COLOR = "#6FC98A";

function asText(v: unknown, max = MAX_TEXT_LEN): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function asOptionalText(v: unknown, max = MAX_TEXT_LEN): string | undefined {
  const t = asText(v, max).trim();
  return t || undefined;
}
function asFiniteNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function asDate(v: unknown, fallback: string): string {
  if (
    typeof v === "string" &&
    DATE_RE.test(v) &&
    !Number.isNaN(new Date(v + "T00:00:00").getTime())
  ) {
    return v;
  }
  return fallback;
}
function asTxType(v: unknown): "income" | "expense" {
  return v === "income" ? "income" : "expense";
}

function sanitizeCategories(raw: unknown[]): Category[] {
  return raw.map((entry) => {
    const c = (entry && typeof entry === "object" ? entry : {}) as Record<
      string,
      unknown
    >;
    return {
      name: asText(c.name, 60).trim() || "Uncategorized",
      icon: asText(c.icon, MAX_ICON_LEN) || "＊",
      color:
        typeof c.color === "string" && HEX_COLOR_RE.test(c.color)
          ? c.color
          : FALLBACK_COLOR,
      budget: Math.max(0, asFiniteNumber(c.budget, 0)),
      archived: c.archived === true,
      type: asTxType(c.type),
    };
  });
}

function sanitizeTransactions(raw: unknown[]): Transaction[] {
  const today = new Date().toISOString().slice(0, 10);
  return raw.map((entry) => {
    const t = (entry && typeof entry === "object" ? entry : {}) as Record<
      string,
      unknown
    >;
    const tags = Array.isArray(t.tags)
      ? t.tags
          .filter((x): x is string => typeof x === "string")
          .slice(0, 20)
          .map((x) => asText(x, 40))
      : undefined;
    return {
      type: asTxType(t.type),
      amount: Math.max(0, asFiniteNumber(t.amount, 0)),
      categoryId: asFiniteNumber(t.categoryId, 0),
      date: asDate(t.date, today),
      merchant: asOptionalText(t.merchant),
      note: asOptionalText(t.note),
      paymentMethod: asOptionalText(t.paymentMethod, 40),
      tags,
      recurringId:
        typeof t.recurringId === "number" && Number.isFinite(t.recurringId)
          ? t.recurringId
          : undefined,
      createdAt: asFiniteNumber(t.createdAt, Date.now()),
    };
  });
}

function sanitizeRecurring(raw: unknown[]): Recurring[] {
  const today = new Date().toISOString().slice(0, 10);
  return raw.map((entry) => {
    const r = (entry && typeof entry === "object" ? entry : {}) as Record<
      string,
      unknown
    >;
    const frequency = VALID_FREQUENCIES.includes(
      r.frequency as (typeof VALID_FREQUENCIES)[number],
    )
      ? (r.frequency as (typeof VALID_FREQUENCIES)[number])
      : "monthly";
    return {
      name: asText(r.name, 60).trim() || "Recurring",
      type: asTxType(r.type),
      amount: Math.max(0, asFiniteNumber(r.amount, 0)),
      categoryId: asFiniteNumber(r.categoryId, 0),
      frequency,
      startDate: asDate(r.startDate, today),
      nextDate: asDate(r.nextDate, today),
      paused: r.paused === true,
      paymentMethod: asOptionalText(r.paymentMethod, 40),
      note: asOptionalText(r.note),
    };
  });
}

function sanitizeSettings(raw: unknown[]): Settings[] {
  return raw.slice(0, 1).map((entry) => {
    const s = (entry && typeof entry === "object" ? entry : {}) as Record<
      string,
      unknown
    >;
    return {
      onboarded: s.onboarded === true,
      currency: asText(s.currency, 4) || "₹",
      theme: s.theme === "light" || s.theme === "system" ? s.theme : "dark",
      monthlyIncome: Math.max(0, asFiniteNumber(s.monthlyIncome, 0)),
      incomeSources: asOptionalText(s.incomeSources, 500),
      carryForward: s.carryForward === true,
    };
  });
}

function stripIds<T extends { id?: number }>(arr: T[]): T[] {
  return arr.map((item) => {
    const { id, ...rest } = item;
    return rest as T;
  });
}

export function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export type { Category, Transaction };
