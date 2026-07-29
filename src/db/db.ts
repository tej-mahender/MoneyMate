import Dexie, { type Table } from 'dexie';

export type TxType = 'expense' | 'income';
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Category {
  id?: number;
  name: string;
  icon: string;
  color: string;
  budget: number;
  archived?: boolean;
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
  theme: 'dark' | 'light' | 'system';
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
    super('pfos_db');
    this.version(1).stores({
      categories: '++id, name, archived',
      transactions: '++id, type, categoryId, date, recurringId',
      recurring: '++id, categoryId, nextDate, paused',
      settings: '++id',
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
    currency: '₹',
    theme: 'dark',
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
export async function processRecurring(todayISO: string) {
  const all = await db.recurring.toArray();
  const items = all.filter((r) => !r.paused);
  for (const item of items) {
    let cursor = item.nextDate;
    let generated = false;
    while (cursor <= todayISO) {
      await db.transactions.add({
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
      await db.recurring.update(item.id!, { nextDate: cursor });
    }
  }
}

export function advanceDate(iso: string, freq: Frequency): string {
  const d = new Date(iso + 'T00:00:00');
  if (freq === 'daily') d.setDate(d.getDate() + 1);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7);
  else if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 0 },
  { name: 'Food', icon: '🍲', color: '#6FC98A', budget: 0 },
  { name: 'Transport', icon: '🚕', color: '#7C93F0', budget: 0 },
  { name: 'Utilities', icon: '💡', color: '#F0A83E', budget: 0 },
  { name: 'Shopping', icon: '🛍️', color: '#E8618C', budget: 0 },
  { name: 'Entertainment', icon: '🎬', color: '#B98CF0', budget: 0 },
  { name: 'Medical', icon: '⚕️', color: '#FF6B6B', budget: 0 },
  { name: 'Savings', icon: '💰', color: '#4FD9B8', budget: 0 },
];
