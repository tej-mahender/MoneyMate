import { describe, it, expect, beforeEach } from 'vitest';
import { db, syncBudgetHistory, computeMonthReport, computeMonthSummary } from './db';
import { exportFullBackup, importFullBackup } from '../lib/csv';
import { monthKey, todayISO } from '../lib/format';

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
  await db.splitShares.clear();
  await db.budgetHistory.clear();
});

async function setup() {
  const bracketId = await db.brackets.add({ name: 'Expenditure', icon: '💳', color: '#7C93F0', kind: 'spend' });
  const food = await db.categories.add({ name: 'Food', icon: '🍲', color: '#6FC98A', budget: 4000, bracketId });
  const rent = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 14000, bracketId });
  return { bracketId, food, rent };
}
const rowsFor = async (id: number) => (await db.budgetHistory.where('categoryId').equals(id).toArray()).sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : (a.id ?? 0) - (b.id ?? 0)));

describe('syncBudgetHistory', () => {
  it('seeds one "migrated" row per category the first time, and is idempotent', async () => {
    const { food, rent } = await setup();
    await syncBudgetHistory('2026-09');
    await syncBudgetHistory('2026-09');
    expect(await db.budgetHistory.count()).toBe(2);
    expect(await rowsFor(food)).toEqual([expect.objectContaining({ month: '2026-09', budget: 4000, origin: 'migrated' })]);
    expect(await rowsFor(rent)).toHaveLength(1);
  });

  it('records a budget change as a new row for the month it happened in; same-month re-edits overwrite', async () => {
    const { food } = await setup();
    await syncBudgetHistory('2026-09');
    await db.categories.update(food, { budget: 5000 });
    await syncBudgetHistory('2026-10');
    await db.categories.update(food, { budget: 5500 });
    await syncBudgetHistory('2026-10');
    expect(await rowsFor(food)).toEqual([
      expect.objectContaining({ month: '2026-09', budget: 4000 }),
      expect.objectContaining({ month: '2026-10', budget: 5500, origin: 'edited' }),
    ]);
  });

  it('archiving records an effective budget of 0 and restoring brings the cap back', async () => {
    const { food } = await setup();
    await syncBudgetHistory('2026-09');
    await db.categories.update(food, { archived: true });
    await syncBudgetHistory('2026-10');
    await db.categories.update(food, { archived: false });
    await syncBudgetHistory('2026-11');
    expect((await rowsFor(food)).map((r) => [r.month, r.budget])).toEqual([['2026-09', 4000], ['2026-10', 0], ['2026-11', 4000]]);
  });

  it('a category added later is "created"; a deleted category\'s rows are pruned', async () => {
    const { bracketId, food } = await setup();
    await syncBudgetHistory('2026-09');
    const gym = await db.categories.add({ name: 'Gym', icon: 'x', color: '#7C93F0', budget: 2000, bracketId });
    await syncBudgetHistory('2026-10');
    expect(await rowsFor(gym)).toEqual([expect.objectContaining({ month: '2026-10', origin: 'created' })]);
    await db.categories.delete(food);
    await syncBudgetHistory('2026-10');
    expect(await rowsFor(food)).toHaveLength(0);
  });
});

describe('computeMonthReport / computeMonthSummary', () => {
  it('a past month keeps its original cap after the budget is raised', async () => {
    const { food } = await setup();
    await syncBudgetHistory('2026-06');
    await db.categories.update(food, { budget: 6000 });
    await syncBudgetHistory('2026-09');
    await db.transactions.add({ type: 'expense', amount: 4500, categoryId: food, date: '2026-07-10', createdAt: 0 });
    const july = await computeMonthReport('2026-07');
    expect(july.rows.find((r) => r.name === 'Food')).toMatchObject({ budget: 4000, spent: 4500, variance: -500 });
    expect(july.approximate).toBe(false);
  });

  it('computeMonthSummary still reports the live current month', async () => {
    const { food } = await setup();
    const date = `${monthKey(todayISO())}-02`;
    await db.transactions.add({ type: 'expense', amount: 1000, categoryId: food, date, createdAt: 0 });
    expect(await computeMonthSummary()).toMatchObject({ spent: 1000, budget: 18000, remaining: 17000 });
  });
});

describe('backup round-trip keeps the budget timeline', () => {
  it('restores history rows onto the freshly assigned category ids', async () => {
    const { food } = await setup();
    await syncBudgetHistory('2026-06');
    await db.categories.update(food, { budget: 6000 });
    await syncBudgetHistory('2026-09');
    const json = await exportFullBackup();
    expect(JSON.parse(json).schemaVersion).toBe(7);

    // Advance the auto-increment counters so ids differ after restore.
    await db.categories.clear();
    await db.categories.bulkAdd([{ name: 'x', icon: 'x', color: '#7C93F0', budget: 1, bracketId: 1 }]);
    await importFullBackup(json);

    const cats = await db.categories.toArray();
    const newFood = cats.find((c) => c.name === 'Food')!;
    const rows = await rowsFor(newFood.id!);
    expect(rows.map((r) => [r.month, r.budget])).toEqual([['2026-06', 4000], ['2026-09', 6000]]);
    expect(await db.budgetHistory.count()).toBe(3); // Food x2 + Rent x1
  });
});

describe('syncBudgetHistory — archived brackets', () => {
  it('archiving a bracket records 0 for all its categories from that month; unarchiving restores their caps', async () => {
    const { bracketId, food, rent } = await setup();
    await syncBudgetHistory('2026-09');
    await db.brackets.update(bracketId, { archived: true });
    await syncBudgetHistory('2026-10');
    await db.brackets.update(bracketId, { archived: false });
    await syncBudgetHistory('2026-11');
    for (const [id, cap] of [[food, 4000], [rent, 14000]] as const) {
      expect((await rowsFor(id)).map((r) => [r.month, r.budget])).toEqual([['2026-09', cap], ['2026-10', 0], ['2026-11', cap]]);
    }
  });

  it('a month before the archive still reports the bracket\'s caps', async () => {
    const { bracketId, food } = await setup();
    await syncBudgetHistory('2026-06');
    await db.brackets.update(bracketId, { archived: true });
    await syncBudgetHistory('2026-09');
    await db.transactions.add({ type: 'expense', amount: 500, categoryId: food, date: '2026-07-05', createdAt: 0 });
    const july = await computeMonthReport('2026-07');
    expect(july.budgeted).toBe(18000);
    expect(july.spent).toBe(500);
  });
});
