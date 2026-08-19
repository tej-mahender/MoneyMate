import Papa from 'papaparse';
import { db, type Category, type Bracket, type BracketKind, type Transaction, type Recurring, type Settings } from '../db/db';
import { monthKey, weekdayName, isWeekend, quarterOf, isoWeek } from './format';

// v5: Category.flow ('spend' | 'allocation' | 'income') was replaced by
// Category.bracketId, referencing a new Bracket table — see db.ts. A
// category now belongs to a bracket (Expenditure/Savings/Investments/
// Income, or a custom one) and inherits that bracket's kind, rather than
// carrying a flat flag itself. Older backups (schemaVersion <= 4, with no
// `brackets` array at all) are still readable: importFullBackup()
// synthesizes the 4 default brackets and infers each category's bracket
// from its old flow/type/name on the way in.
export const SCHEMA_VERSION = 5;

/** Prevents CSV formula injection: a cell starting with =, +, -, or @ gets
 *  interpreted as a formula by Excel/Sheets when the file is opened. Prefixing
 *  with a leading apostrophe forces it to be read as literal text instead. */
function sanitizeCsvCell(v: string): string {
  if (/^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

async function loadAll() {
  const [transactions, categories, brackets, recurring, settings] = await Promise.all([
    db.transactions.toArray(),
    db.categories.toArray(),
    db.brackets.toArray(),
    db.recurring.toArray(),
    db.settings.toArray(),
  ]);
  return { transactions, categories, brackets, recurring, settings };
}

/** Flat, ML/BI-ready transaction records: one row per transaction with every
 *  date feature a model or Power BI pivot would otherwise have to recompute. */
function enrichedTransactionRows(transactions: Transaction[], categories: Category[]) {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  let running = 0;
  return transactions
    .slice()
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1))
    .map((t) => {
      running += t.type === 'income' ? t.amount : -t.amount;
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
        Category: sanitizeCsvCell(cat?.name || 'Uncategorized'),
        Merchant: sanitizeCsvCell(t.merchant || ''),
        PaymentMethod: t.paymentMethod || '',
        Amount: t.amount,
        Type: t.type,
        RunningBalance: Math.round(running * 100) / 100,
        IsRecurring: Boolean(t.recurringId),
        Notes: sanitizeCsvCell(t.note || ''),
        Tags: sanitizeCsvCell((t.tags || []).join('|')),
      };
    });
}

export async function exportTransactionsCSV(): Promise<string> {
  const { transactions, categories } = await loadAll();
  return Papa.unparse(enrichedTransactionRows(transactions, categories));
}

/** Dimension table for brackets — Expenditure/Savings/Investments/Income or
 *  any custom ones. Pairs with pfos-categories-*.csv via BracketId. */
export async function exportBracketsCSV(): Promise<string> {
  const { brackets } = await loadAll();
  const rows = brackets.map((b) => ({
    BracketId: b.id,
    Name: sanitizeCsvCell(b.name),
    Kind: b.kind,
    Icon: b.icon,
    Color: b.color,
    Archived: Boolean(b.archived),
  }));
  return Papa.unparse(rows);
}

/** Dimension table — pairs with the transactions fact table in Power BI via CategoryId. */
export async function exportCategoriesCSV(): Promise<string> {
  const { categories, brackets } = await loadAll();
  const bracketMap = new Map(brackets.map((b) => [b.id, b]));
  const rows = categories.map((c) => {
    const bracket = bracketMap.get(c.bracketId);
    return {
      CategoryId: c.id,
      Name: sanitizeCsvCell(c.name),
      BracketId: c.bracketId,
      BracketName: sanitizeCsvCell(bracket?.name ?? ''),
      BracketKind: bracket?.kind ?? 'spend',
      Icon: c.icon,
      Color: c.color,
      MonthlyBudget: c.budget,
      Archived: Boolean(c.archived),
    };
  });
  return Papa.unparse(rows);
}

/** Pre-aggregated month x category fact table — the natural grain for a Power BI
 *  budget-vs-actual report without needing measures computed in DAX. */
export async function exportMonthlySummaryCSV(): Promise<string> {
  const { transactions, categories, brackets } = await loadAll();
  const bracketMap = new Map(brackets.map((b) => [b.id, b]));
  const months = Array.from(new Set(transactions.map((t) => monthKey(t.date)))).sort();
  const rows: Record<string, string | number | null>[] = [];
  for (const m of months) {
    for (const c of categories) {
      const actual = transactions
        .filter((t) => t.type === 'expense' && t.categoryId === c.id && monthKey(t.date) === m)
        .reduce((s, t) => s + t.amount, 0);
      if (actual === 0 && c.budget === 0) continue;
      const bracket = bracketMap.get(c.bracketId);
      rows.push({
        Month: m,
        CategoryId: c.id ?? -1,
        CategoryName: sanitizeCsvCell(c.name),
        BracketId: c.bracketId,
        BracketName: sanitizeCsvCell(bracket?.name ?? ''),
        BracketKind: bracket?.kind ?? 'spend',
        Budget: c.budget,
        Actual: Math.round(actual * 100) / 100,
        Variance: Math.round((c.budget - actual) * 100) / 100,
        PctOfBudget: c.budget > 0 ? Math.round((actual / c.budget) * 1000) / 10 : null,
      });
    }
  }
  return Papa.unparse(rows);
}

/** A single bundled JSON dataset — transactions (enriched), categories, brackets,
 *  and the monthly summary — sized for a Python/pandas ML notebook to load in one
 *  shot (`pd.json_normalize(data['transactions'])`) without juggling several files. */
export async function exportMLDatasetJSON(): Promise<string> {
  const { transactions, categories, brackets, recurring, settings } = await loadAll();
  const s = settings[0];
  const bracketMap = new Map(brackets.map((b) => [b.id, b]));
  const months = Array.from(new Set(transactions.map((t) => monthKey(t.date)))).sort();
  const monthlySummary = months.flatMap((m) =>
    categories.map((c) => {
      const actual = transactions
        .filter((t) => t.type === 'expense' && t.categoryId === c.id && monthKey(t.date) === m)
        .reduce((s2, t) => s2 + t.amount, 0);
      const bracket = bracketMap.get(c.bracketId);
      return {
        month: m, categoryId: c.id, categoryName: c.name,
        bracketId: c.bracketId, bracketName: bracket?.name, bracketKind: bracket?.kind,
        budget: c.budget, actual: Math.round(actual * 100) / 100,
        variance: Math.round((c.budget - actual) * 100) / 100,
      };
    })
  );
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    currency: s?.currency || '₹',
    transactions: enrichedTransactionRows(transactions, categories),
    categories,
    brackets,
    recurring,
    monthlySummary,
  }, null, 2);
}

export async function exportFullBackup(): Promise<string> {
  const { categories, brackets, transactions, recurring, settings } = await loadAll();
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    brackets, categories, transactions, recurring, settings,
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

export async function importFullBackup(json: string) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !Array.isArray(data.categories) || !Array.isArray(data.transactions)) {
    throw new Error('Invalid backup file');
  }

  // A backup written by a newer app version might use a data shape this
  // version doesn't understand yet — refuse rather than silently importing
  // something that could half-apply and leave the DB in a weird state.
  if (typeof data.schemaVersion === 'number' && data.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      'This backup was created with a newer version of Money Mate. Please update the app before restoring it.',
    );
  }

  const bracketsRaw: unknown[] = Array.isArray(data.brackets) ? data.brackets : [];
  const recurringRaw: unknown[] = Array.isArray(data.recurring) ? data.recurring : [];

  // Generous sanity cap — not a real-world size any real backup would hit,
  // just a guard against a corrupted/hostile file freezing the tab on import.
  const MAX_RECORDS = 200_000;
  if (
    data.categories.length > MAX_RECORDS ||
    data.transactions.length > MAX_RECORDS ||
    bracketsRaw.length > MAX_RECORDS ||
    recurringRaw.length > MAX_RECORDS
  ) {
    throw new Error('Backup file is too large to import.');
  }

  // A pre-v5 backup has no `brackets` array at all — categories back then
  // carried a flat `flow` field instead of belonging to a bracket. Rather
  // than reject those backups, this synthesizes the same 4 default brackets
  // the live Dexie v4 migration creates and infers each category's bracket
  // from its old flow/type/name, so a backup restore never regresses behind
  // what an in-place app upgrade would have given the same data.
  const hasBrackets = bracketsRaw.length > 0;
  const brackets = hasBrackets ? sanitizeBrackets(bracketsRaw) : [];

  const transactions = sanitizeTransactions(data.transactions);
  const recurring = sanitizeRecurring(recurringRaw);

  // IndexedDB's auto-increment key generator is NOT reset by clear() — that's
  // spec behavior, not a bug in this app, but it means a device that's been
  // used for a while (ids already advanced past 1) will assign brackets,
  // categories, and recurring items brand-new ids on import that do NOT
  // match the old ids recorded in the backup file. Without an explicit
  // remap here, every category's bracketId / transaction's categoryId /
  // recurringId would silently point at the wrong row (or nothing at all)
  // the moment a restore happens on anything but a just-installed app.
  const extractId = (entry: unknown): number | undefined =>
    entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).id === 'number'
      ? (entry as Record<string, unknown>).id as number
      : undefined;
  const oldBracketIds = bracketsRaw.map(extractId);
  const oldCategoryIds = (data.categories as unknown[]).map(extractId);
  const oldRecurringIds = recurringRaw.map(extractId);

  await db.transaction('rw', db.brackets, db.categories, db.transactions, db.recurring, db.settings, async () => {
    await db.brackets.clear();
    await db.categories.clear();
    await db.transactions.clear();
    await db.recurring.clear();
    await db.settings.clear();

    const bracketIdMap = new Map<number, number>();
    let legacyIds: LegacyBracketIds | null = null;

    if (hasBrackets) {
      const newIds = await db.brackets.bulkAdd(stripIds<Bracket>(brackets), { allKeys: true });
      newIds.forEach((newId, i) => {
        const oldId = oldBracketIds[i];
        if (typeof oldId === 'number') bracketIdMap.set(oldId, newId);
      });
    } else {
      const expenditureId = await db.brackets.add({ name: 'Expenditure', icon: '💳', color: '#7C93F0', kind: 'spend' });
      const savingsId = await db.brackets.add({ name: 'Savings', icon: '💰', color: '#4FD9B8', kind: 'allocation' });
      const investmentsId = await db.brackets.add({ name: 'Investments', icon: '📈', color: '#B98CF0', kind: 'allocation' });
      const incomeId = await db.brackets.add({ name: 'Income', icon: '💼', color: '#6FC98A', kind: 'income' });
      legacyIds = { expenditureId, savingsId, investmentsId, incomeId };
    }

    const fallbackBracketId = hasBrackets ? [...bracketIdMap.values()][0] : legacyIds!.expenditureId;
    const categories = sanitizeCategories(data.categories, (c) => {
      if (hasBrackets) {
        const rawBracketId = typeof c.bracketId === 'number' ? c.bracketId : undefined;
        const mapped = rawBracketId !== undefined ? bracketIdMap.get(rawBracketId) : undefined;
        return mapped ?? fallbackBracketId ?? 0;
      }
      return legacyFlowToBracketId(c.flow, c.type, c.name, legacyIds!);
    });

    const categoryIdMap = new Map<number, number>();
    if (categories.length) {
      const newIds = await db.categories.bulkAdd(stripIds<Category>(categories), { allKeys: true });
      newIds.forEach((newId, i) => {
        const oldId = oldCategoryIds[i];
        if (typeof oldId === 'number') categoryIdMap.set(oldId, newId);
      });
    }

    const recurringIdMap = new Map<number, number>();
    if (recurring.length) {
      const newIds = await db.recurring.bulkAdd(stripIds<Recurring>(recurring), { allKeys: true });
      newIds.forEach((newId, i) => {
        const oldId = oldRecurringIds[i];
        if (typeof oldId === 'number') recurringIdMap.set(oldId, newId);
      });
    }

    if (transactions.length) {
      const remapped = transactions.map((t) => ({
        ...t,
        categoryId: categoryIdMap.get(t.categoryId) ?? t.categoryId,
        recurringId: t.recurringId !== undefined ? recurringIdMap.get(t.recurringId) : undefined,
      }));
      await db.transactions.bulkAdd(stripIds<Transaction>(remapped));
    }
    if (Array.isArray(data.settings) && data.settings.length) {
      await db.settings.bulkAdd(sanitizeSettings(data.settings));
    }
  });
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
// Old category/recurring ids referenced by transactions are explicitly
// remapped onto the freshly-assigned ids in importFullBackup() above, rather
// than assumed to line up positionally — see the comment there.

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const MAX_TEXT_LEN = 200;
const MAX_ICON_LEN = 8; // generous enough for multi-codepoint emoji (ZWJ sequences, skin tones)
const FALLBACK_COLOR = '#6FC98A';

function asText(v: unknown, max = MAX_TEXT_LEN): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function asOptionalText(v: unknown, max = MAX_TEXT_LEN): string | undefined {
  const t = asText(v, max).trim();
  return t || undefined;
}
function asFiniteNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asDate(v: unknown, fallback: string): string {
  if (typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(new Date(v + 'T00:00:00').getTime())) {
    return v;
  }
  return fallback;
}
function asTxType(v: unknown): 'income' | 'expense' {
  return v === 'income' ? 'income' : 'expense';
}

type LegacyBracketIds = { expenditureId: number; savingsId: number; investmentsId: number; incomeId: number };

/** Infers the right bracket for a category from a pre-v5 backup, which only
 *  ever had a flat `flow` field (or, pre-v4, `type`) rather than a real
 *  bracketId. Mirrors the same "match on the only signal available" logic
 *  the live Dexie v4 migration uses on upgrade, so a backup restore never
 *  regresses behind what an in-place upgrade would have given the same
 *  data: 'income' → Income, an allocation named like "Investments" →
 *  Investments, any other allocation → Savings, everything else → Expenditure. */
function legacyFlowToBracketId(flow: unknown, legacyType: unknown, name: unknown, ids: LegacyBracketIds): number {
  const resolvedFlow =
    flow === 'spend' || flow === 'allocation' || flow === 'income'
      ? flow
      : legacyType === 'income'
        ? 'income'
        : typeof name === 'string' && name.trim() === 'Savings'
          ? 'allocation'
          : 'spend';
  if (resolvedFlow === 'income') return ids.incomeId;
  if (resolvedFlow === 'allocation') {
    return typeof name === 'string' && /invest/i.test(name) ? ids.investmentsId : ids.savingsId;
  }
  return ids.expenditureId;
}

function sanitizeBrackets(raw: unknown[]): Bracket[] {
  return raw.map((entry) => {
    const b = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const kind: BracketKind = b.kind === 'allocation' || b.kind === 'income' ? b.kind : 'spend';
    return {
      name: asText(b.name, 60).trim() || 'Bracket',
      icon: asText(b.icon, MAX_ICON_LEN) || '＊',
      color: typeof b.color === 'string' && HEX_COLOR_RE.test(b.color) ? b.color : FALLBACK_COLOR,
      kind,
      archived: b.archived === true,
    };
  });
}

function sanitizeCategories(raw: unknown[], bracketIdFor: (c: Record<string, unknown>) => number): Category[] {
  return raw.map((entry) => {
    const c = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    return {
      name: asText(c.name, 60).trim() || 'Uncategorized',
      icon: asText(c.icon, MAX_ICON_LEN) || '＊',
      color: typeof c.color === 'string' && HEX_COLOR_RE.test(c.color) ? c.color : FALLBACK_COLOR,
      budget: Math.max(0, asFiniteNumber(c.budget, 0)),
      archived: c.archived === true,
      bracketId: bracketIdFor(c),
    };
  });
}

function sanitizeTransactions(raw: unknown[]): Transaction[] {
  const today = new Date().toISOString().slice(0, 10);
  return raw.map((entry) => {
    const t = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const tags = Array.isArray(t.tags)
      ? t.tags.filter((x): x is string => typeof x === 'string').slice(0, 20).map((x) => asText(x, 40))
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
      recurringId: typeof t.recurringId === 'number' && Number.isFinite(t.recurringId) ? t.recurringId : undefined,
      createdAt: asFiniteNumber(t.createdAt, Date.now()),
    };
  });
}

function sanitizeRecurring(raw: unknown[]): Recurring[] {
  const today = new Date().toISOString().slice(0, 10);
  return raw.map((entry) => {
    const r = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const frequency = VALID_FREQUENCIES.includes(r.frequency as (typeof VALID_FREQUENCIES)[number])
      ? (r.frequency as (typeof VALID_FREQUENCIES)[number])
      : 'monthly';
    return {
      name: asText(r.name, 60).trim() || 'Recurring',
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
    const s = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    return {
      onboarded: s.onboarded === true,
      currency: asText(s.currency, 4) || '₹',
      theme: s.theme === 'light' || s.theme === 'system' ? s.theme : 'dark',
      monthlyIncome: Math.max(0, asFiniteNumber(s.monthlyIncome, 0)),
      incomeSources: asOptionalText(s.incomeSources, 500),
      carryForward: s.carryForward === true,
      hideWidgetAmounts: s.hideWidgetAmounts === true,
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
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export type { Category, Transaction };
