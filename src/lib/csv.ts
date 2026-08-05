import Papa from "papaparse";
import { db, type Category, type Transaction, type Recurring } from "../db/db";
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
  if (!data.categories || !data.transactions)
    throw new Error("Invalid backup file");
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
      if (data.categories?.length)
        await db.categories.bulkAdd(stripIds<Category>(data.categories));
      if (data.transactions?.length)
        await db.transactions.bulkAdd(stripIds<Transaction>(data.transactions));
      if (data.recurring?.length)
        await db.recurring.bulkAdd(stripIds<Recurring>(data.recurring));
      if (data.settings?.length) await db.settings.bulkAdd(data.settings);
    },
  );
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
