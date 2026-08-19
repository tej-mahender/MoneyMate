import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../pages/Dashboard';
import Overview from '../pages/Overview';
import { db, computeMonthSummary } from '../db/db';
import { exportTransactionsCSV, exportFullBackup } from '../lib/csv';

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

/** Seeds N categories (a mix of spend/allocation) under 2 brackets and daily
 *  transactions going back `years` years — a rough stand-in for "someone
 *  who's used this app every day for a few years", the realistic ceiling
 *  for a single-user offline finance app rather than a synthetic worst case. */
async function seedRealisticHistory(years: number, categoriesCount = 12) {
  const spendBracketId = await db.brackets.add({ name: 'Expenditure', icon: '💳', color: '#7C93F0', kind: 'spend' });
  const allocationBracketId = await db.brackets.add({ name: 'Savings', icon: '💰', color: '#4FD9B8', kind: 'allocation' });
  const bracketIds = [spendBracketId, spendBracketId, spendBracketId, spendBracketId, spendBracketId, allocationBracketId];
  const categoryIds: number[] = [];
  for (let i = 0; i < categoriesCount; i++) {
    const id = await db.categories.add({
      name: `Category ${i}`,
      icon: '💳',
      color: '#7C93F0',
      budget: 5000,
      bracketId: bracketIds[i % bracketIds.length],
    });
    categoryIds.push(id as number);
  }

  const days = years * 365;
  const today = new Date();
  const rows: { type: 'expense'; amount: number; categoryId: number; date: string; createdAt: number }[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const iso = date.toISOString().slice(0, 10);
    rows.push({
      type: 'expense',
      amount: 50 + (d % 500),
      categoryId: categoryIds[d % categoryIds.length],
      date: iso,
      createdAt: Date.now() - d * 86400000,
    });
  }
  await db.transactions.bulkAdd(rows);
  return { categoryIds, transactionCount: rows.length };
}

describe('performance — computeMonthSummary (used by widget sync)', () => {
  it('stays fast (<150ms) against 3 years of daily transaction history', async () => {
    const { transactionCount } = await seedRealisticHistory(3);
    expect(transactionCount).toBeGreaterThan(1000);

    const start = performance.now();
    const summary = await computeMonthSummary();
    const elapsed = performance.now() - start;

    expect(summary.spent).toBeGreaterThan(0);
    // Generous for a CI/sandbox machine — real devices will be faster. This
    // is a regression guard (catches an accidental full-table scan sneaking
    // back in), not a strict SLA. It works because the query is already
    // indexed: db.transactions.where('date').startsWith(curMonth), so cost
    // scales with "days in this month", not with total history.
    expect(elapsed).toBeLessThan(150);
  });

  it('cost does not scale with total history size (indexed month lookup, not a full-table scan)', async () => {
    await seedRealisticHistory(1);
    const t1Start = performance.now();
    await computeMonthSummary();
    const t1 = performance.now() - t1Start;

    await db.transactions.clear();
    await db.categories.clear();
    await db.brackets.clear();
    await seedRealisticHistory(6); // 6x the history
    const t2Start = performance.now();
    await computeMonthSummary();
    const t2 = performance.now() - t2Start;

    // If this were an accidental full-table scan, t2 would be roughly 6x
    // t1. Allowing generous headroom (5x) still catches that regression
    // class without being flaky on a noisy CI machine.
    expect(t2).toBeLessThan(Math.max(t1 * 5, 50));
  });
});

describe('performance — Dashboard / Overview render against realistic history', () => {
  it('Dashboard mounts in reasonable time with 3 years of history', async () => {
    await seedRealisticHistory(3);
    const start = performance.now();
    render(
      <MemoryRouter>
        <Dashboard currency="₹" />
      </MemoryRouter>,
    );
    const elapsed = performance.now() - start;
    // jsdom rendering is materially slower than a real browser/WebView —
    // this threshold is a coarse regression guard, not a device benchmark.
    expect(elapsed).toBeLessThan(3000);
  });

  it('Overview mounts in reasonable time with 3 years of history', async () => {
    await seedRealisticHistory(3);
    const start = performance.now();
    render(
      <MemoryRouter>
        <Overview currency="₹" monthlyIncome={50000} />
      </MemoryRouter>,
    );
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  // Flags the specific scalability characteristic worth knowing about:
  // both screens pull the *entire* transactions table into memory via
  // db.transactions.toArray() and filter client-side for "this month",
  // rather than using the indexed date query computeMonthSummary() uses.
  // Fine at personal-app scale (a few thousand rows), but the cost does
  // grow with total history, unlike computeMonthSummary above — worth
  // revisiting with an indexed query if history ever reaches tens of
  // thousands of transactions.
  it('documents that Dashboard render cost grows with total history size (client-side month filter)', async () => {
    await seedRealisticHistory(1);
    const t1Start = performance.now();
    render(
      <MemoryRouter>
        <Dashboard currency="₹" />
      </MemoryRouter>,
    );
    const t1 = performance.now() - t1Start;

    await db.transactions.clear();
    await db.categories.clear();
    await db.brackets.clear();
    await seedRealisticHistory(10);
    const t2Start = performance.now();
    render(
      <MemoryRouter>
        <Dashboard currency="₹" />
      </MemoryRouter>,
    );
    const t2 = performance.now() - t2Start;

    // Not a pass/fail assertion on the ratio (this is expected, documented
    // behavior, not a bug) — just a sanity ceiling so a render doesn't
    // regress into something pathological (e.g. an accidental O(n²)).
    expect(t2).toBeLessThan(5000);
    expect(t1).toBeLessThan(5000);
  });
});

describe('performance/capability — CSV export at scale', () => {
  it('exportTransactionsCSV produces one correctly-formed row per transaction across 3 years of history', async () => {
    const { transactionCount } = await seedRealisticHistory(3);
    const start = performance.now();
    const csv = await exportTransactionsCSV();
    const elapsed = performance.now() - start;

    const lines = csv.trim().split('\n');
    // header + one row per transaction
    expect(lines.length).toBe(transactionCount + 1);
    expect(elapsed).toBeLessThan(2000);
  });

  it('exportFullBackup round-trips category and transaction counts correctly at scale', async () => {
    const { categoryIds, transactionCount } = await seedRealisticHistory(2, 20);
    const backup = await exportFullBackup();
    const parsed = JSON.parse(backup);
    expect(parsed.categories.length).toBe(categoryIds.length);
    expect(parsed.transactions.length).toBe(transactionCount);
  });
});
