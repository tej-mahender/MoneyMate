import { describe, it, expect, beforeEach } from 'vitest';
import { buildMonthReport, budgetForMonth } from './monthReport';
import type { Bracket, BudgetHistoryEntry, Category, Transaction } from '../db/db';

const TODAY = '2026-10-04';
const spend: Bracket = { id: 1, name: 'Expenditure', icon: '💳', color: '#7C93F0', kind: 'spend' };
const savings: Bracket = { id: 2, name: 'Savings', icon: '💰', color: '#4FD9B8', kind: 'allocation' };
let txId = 0;
beforeEach(() => { txId = 0; });
const cat = (id: number, name: string, budget: number, extra: Partial<Category> = {}): Category => ({
  id, name, icon: 'x', color: '#F0B94D', budget, bracketId: 1, ...extra,
});
const tx = (categoryId: number, amount: number, date: string, type: 'expense' | 'income' = 'expense'): Transaction => ({
  id: ++txId, type, amount, categoryId, date, createdAt: 0,
});
const h = (categoryId: number, month: string, budget: number, origin: BudgetHistoryEntry['origin'] = 'edited', id?: number): BudgetHistoryEntry => ({
  id, categoryId, month, budget, origin, createdAt: 0,
});

describe('buildMonthReport — current month matches the Budget screen definition', () => {
  it('sums capped budgets and spend, excludes allocations, and skips archived categories\' budget but not their spend', () => {
    const cats = [cat(1, 'Rent', 20000), cat(2, 'Food', 5000), cat(3, 'Old', 1000, { archived: true }), cat(4, 'Savings', 10000, { bracketId: 2 })];
    const r = buildMonthReport('2026-10', {
      brackets: [spend, savings], categories: cats, history: [], today: TODAY,
      transactions: [tx(1, 20000, '2026-10-01'), tx(2, 6000, '2026-10-02'), tx(3, 300, '2026-10-03'), tx(4, 10000, '2026-10-03'), tx(1, 90000, '2026-10-01', 'income')],
    });
    expect(r.isCurrent).toBe(true);
    expect(r.budgeted).toBe(25000);
    expect(r.spent).toBe(26300);
    expect(r.remaining).toBe(-1300);
    expect(r.verdict).toBe('over');
    expect(r.income).toBe(90000);
    expect(r.overCount).toBe(1); // Food
    expect(r.unbudgetedSpent).toBe(300); // archived "Old" has no cap now
    expect(r.allocations).toEqual([expect.objectContaining({ name: 'Savings', target: 10000, actual: 10000 })]);
  });

  it('ignores transactions from other months and reports orphaned spend separately', () => {
    const r = buildMonthReport('2026-10', {
      brackets: [spend], categories: [cat(1, 'Rent', 100)], history: [], today: TODAY,
      transactions: [tx(1, 40, '2026-10-02'), tx(1, 999, '2026-09-02'), tx(77, 25, '2026-10-02')],
    });
    expect(r.spent).toBe(40);
    expect(r.uncategorizedSpent).toBe(25);
  });

  it('an archived spend bracket has no cap now, but its spend still counts and earlier months still report it', () => {
    const brackets = [{ ...spend, archived: true }];
    const cats = [cat(1, 'Rent', 100)];
    const history = [h(1, '2026-06', 100, 'migrated', 1), h(1, '2026-10', 0, 'edited', 2)];
    const now = buildMonthReport('2026-10', { brackets, categories: cats, history, today: TODAY, transactions: [tx(1, 40, '2026-10-02')] });
    expect(now.budgeted).toBe(0);
    expect(now.spent).toBe(40);
    expect(now.unbudgetedSpent).toBe(40);
    const before = buildMonthReport('2026-08', { brackets, categories: cats, history, today: TODAY, transactions: [tx(1, 40, '2026-08-02')] });
    expect(before.budgeted).toBe(100);
    expect(before.rows).toHaveLength(1);
  });
});

describe('buildMonthReport — closed months use the cap that applied then', () => {
  const cats = [cat(1, 'Food', 6000)]; // current cap is 6000
  const history = [h(1, '2026-06', 4000, 'migrated', 1), h(1, '2026-09', 6000, 'edited', 2)];

  it('July still reports the 4000 cap even though Food is 6000 today', () => {
    const r = buildMonthReport('2026-07', {
      brackets: [spend], categories: cats, history, today: TODAY,
      transactions: [tx(1, 4500, '2026-07-10')],
    });
    expect(r.budgeted).toBe(4000);
    expect(r.rows[0]).toMatchObject({ budget: 4000, spent: 4500, variance: -500, status: 'over' });
    expect(r.approximate).toBe(false);
  });

  it('September picks up the new cap from its own month', () => {
    expect(buildMonthReport('2026-09', { brackets: [spend], categories: cats, history, today: TODAY, transactions: [] }).budgeted).toBe(6000);
  });

  it('a month before tracking began reuses the earliest known cap and is flagged approximate', () => {
    const r = buildMonthReport('2026-03', { brackets: [spend], categories: cats, history, today: TODAY, transactions: [tx(1, 100, '2026-03-05')] });
    expect(r.budgeted).toBe(4000);
    expect(r.approximate).toBe(true);
  });

  it('a category created later does not inflate earlier months\' budget', () => {
    const c = [cat(1, 'Food', 6000), cat(2, 'Gym', 2000)];
    const hist = [h(1, '2026-06', 6000, 'migrated', 1), h(2, '2026-09', 2000, 'created', 2)];
    expect(buildMonthReport('2026-07', { brackets: [spend], categories: c, history: hist, today: TODAY, transactions: [] }).budgeted).toBe(6000);
    expect(buildMonthReport('2026-09', { brackets: [spend], categories: c, history: hist, today: TODAY, transactions: [] }).budgeted).toBe(8000);
  });

  it('an archived category keeps counting in the months before it was archived', () => {
    const c = [cat(1, 'Gym', 2000, { archived: true })];
    const hist = [h(1, '2026-06', 2000, 'migrated', 1), h(1, '2026-09', 0, 'edited', 2)];
    expect(budgetForMonth(c[0], '2026-08', hist, '2026-10')).toBe(2000);
    expect(budgetForMonth(c[0], '2026-09', hist, '2026-10')).toBe(0);
  });
});
