import Papa from 'papaparse';
import { db, type Category, type Transaction, type Recurring } from '../db/db';

export async function exportTransactionsCSV(): Promise<string> {
  const [txs, cats] = await Promise.all([db.transactions.toArray(), db.categories.toArray()]);
  const catMap = new Map(cats.map((c) => [c.id, c.name]));
  let running = 0;
  const rows = txs
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((t) => {
      running += t.type === 'income' ? t.amount : -t.amount;
      return {
        Date: t.date,
        Category: catMap.get(t.categoryId) || 'Uncategorized',
        Merchant: t.merchant || '',
        'Payment Method': t.paymentMethod || '',
        Amount: t.amount,
        'Income/Expense': t.type,
        'Running Balance': Math.round(running * 100) / 100,
        Notes: t.note || '',
        Tags: (t.tags || []).join('|'),
      };
    });
  return Papa.unparse(rows);
}

export async function exportFullBackup(): Promise<string> {
  const [categories, transactions, recurring, settings] = await Promise.all([
    db.categories.toArray(),
    db.transactions.toArray(),
    db.recurring.toArray(),
    db.settings.toArray(),
  ]);
  return JSON.stringify({ categories, transactions, recurring, settings, exportedAt: new Date().toISOString() }, null, 2);
}

export async function importFullBackup(json: string) {
  const data = JSON.parse(json);
  if (!data.categories || !data.transactions) throw new Error('Invalid backup file');
  await db.transaction('rw', db.categories, db.transactions, db.recurring, db.settings, async () => {
    await db.categories.clear();
    await db.transactions.clear();
    await db.recurring.clear();
    await db.settings.clear();
    if (data.categories?.length) await db.categories.bulkAdd(stripIds<Category>(data.categories));
    if (data.transactions?.length) await db.transactions.bulkAdd(stripIds<Transaction>(data.transactions));
    if (data.recurring?.length) await db.recurring.bulkAdd(stripIds<Recurring>(data.recurring));
    if (data.settings?.length) await db.settings.bulkAdd(data.settings);
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
