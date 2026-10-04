import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import Analytics from './Analytics';
import { db } from '../db/db';
import { fmtMoney, monthKey, todayISO } from '../lib/format';

// Each test gets a clean database — fake-indexeddb persists across tests
// within a run otherwise, which would let state leak between cases.
beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

function renderAnalytics() {
  return render(<Analytics currency="₹" />);
}

async function makeBracket(kind: 'spend' | 'allocation' | 'income', name = 'Expenditure') {
  return db.brackets.add({ name, icon: '💳', color: '#7C93F0', kind });
}

describe('Analytics — "Spent" scoping matches Dashboard\'s definition', () => {
  it('excludes allocation-category transactions (Savings) from "Spent", the pie chart, and top merchants', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket('spend', 'Expenditure');
    const savingsBracketId = await makeBracket('allocation', 'Savings');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    const savingsId = await db.categories.add({ name: 'Savings', icon: '💰', color: '#4FD9B8', budget: 10000, bracketId: savingsBracketId });

    await db.transactions.add({ type: 'expense', amount: 8000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now(), merchant: 'Landlord' });
    // A transfer into Savings — real money moved, but not spend.
    await db.transactions.add({ type: 'expense', amount: 10000, categoryId: savingsId, date: thisMonthDate, createdAt: Date.now(), merchant: 'Bank' });

    renderAnalytics();

    // "Spent" on the "At a glance" card must reflect only Rent (8000),
    // not 8000+10000 with the Savings transfer folded in. (Using findAllBy
    // since "Avg / tx" also happens to read 8000 with a single transaction.)
    expect((await screen.findAllByText(fmtMoney(8000, '₹'))).length).toBeGreaterThan(0);
    expect(screen.queryByText(fmtMoney(18000, '₹'))).not.toBeInTheDocument();

    // Top merchants must not list the Savings transfer either.
    expect(screen.queryByText('Bank')).not.toBeInTheDocument();
  });

  it('still counts spend normally when there are no allocation categories at all', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket('spend', 'Expenditure');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    await db.transactions.add({ type: 'expense', amount: 8000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });

    renderAnalytics();

    expect((await screen.findAllByText(fmtMoney(8000, '₹'))).length).toBeGreaterThan(0);
  });

  it('excludes allocation-category spend from the previous-period figure too, so month-over-month % compares like with like', async () => {
    const thisMonthKey = monthKey(todayISO());
    const thisMonthDate = `${thisMonthKey}-15`;
    const [y, m] = thisMonthKey.split('-').map(Number);
    const prevMonthKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const prevMonthDate = `${prevMonthKey}-15`;

    const expenditureId = await makeBracket('spend', 'Expenditure');
    const savingsBracketId = await makeBracket('allocation', 'Savings');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    const savingsId = await db.categories.add({ name: 'Savings', icon: '💰', color: '#4FD9B8', budget: 10000, bracketId: savingsBracketId });

    // This month: 8000 rent only (no savings transfer this month).
    await db.transactions.add({ type: 'expense', amount: 8000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });
    // Last month: 8000 rent + a 50000 savings transfer. If the savings
    // transfer leaked into prevSpent, this month would look like a huge
    // (~86%) drop; it should instead show no real change (0%, so no
    // month-over-month insight line renders at all).
    await db.transactions.add({ type: 'expense', amount: 8000, categoryId: rentId, date: prevMonthDate, createdAt: Date.now() });
    await db.transactions.add({ type: 'expense', amount: 50000, categoryId: savingsId, date: prevMonthDate, createdAt: Date.now() });

    renderAnalytics();

    await screen.findAllByText(fmtMoney(8000, '₹'));
    // If the 50000 savings transfer had leaked into prevSpent, this would
    // show a fake ~86% drop. With it correctly excluded, both months are
    // really 8000, so the line reads a flat 0% change.
    expect(await screen.findByText(/Down 0% vs\. the previous period/)).toBeInTheDocument();
  });
});

describe('Analytics — "Month" range can step back to browse a closed past month', () => {
  it('stepping back one month shows an isolated snapshot of that month, not blended with the current one', async () => {
    const thisMonthKey = monthKey(todayISO());
    const [y, m] = thisMonthKey.split('-').map(Number);
    const prevMonthKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;

    const expenditureId = await makeBracket('spend', 'Expenditure');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    await db.transactions.add({ type: 'expense', amount: 5000, categoryId: rentId, date: `${thisMonthKey}-10`, createdAt: Date.now() });
    await db.transactions.add({ type: 'expense', amount: 7000, categoryId: rentId, date: `${prevMonthKey}-10`, createdAt: Date.now() });

    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderAnalytics();

    expect((await screen.findAllByText(fmtMoney(5000, '₹'))).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    expect((await screen.findAllByText(fmtMoney(7000, '₹'))).length).toBeGreaterThan(0);
    expect(screen.queryByText(fmtMoney(5000, '₹'))).not.toBeInTheDocument();
  });

  it('the "Next month" arrow is disabled at the current month — can\'t browse into the future', async () => {
    renderAnalytics();
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  it('the "Next month" arrow re-enables after stepping back, and stepping forward again returns to the current month', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderAnalytics();

    await user.click(await screen.findByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('button', { name: 'Next month' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });

  it('switching to a different range and back to "Month" resets to the current month, not a stale stepped-back one', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderAnalytics();

    await user.click(await screen.findByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByText('3 months'));
    await user.click(screen.getByText('This month'));

    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
  });
});


describe('Analytics — "Where it went" donut selection', () => {
  it('selects a slice, switches to another, and clears via the same slice, a tap anywhere else, or a legend row; slice colours are unique', async () => {
    const bracketId = await makeBracket('spend');
    const date = `${monthKey(todayISO())}-10`;
    for (const [name, amount] of [['Rent', 14000], ['Food', 3000], ['Tea', 500]] as const) {
      const id = await db.categories.add({ name, icon: '💳', color: '#F0B94D', budget: 1, bracketId });
      await db.transactions.add({ type: 'expense', amount, categoryId: id, date, createdAt: Date.now() });
    }
    const { container } = renderAnalytics();
    await screen.findAllByText('Rent');
    const arcs = () => container.querySelectorAll('.pie-arc');
    const center = () => container.querySelector('.pie-center')!.textContent;

    expect(arcs().length).toBe(3);
    fireEvent.click(arcs()[1]);
    expect(center()).toContain('Food');
    fireEvent.click(arcs()[1]);
    expect(center()).toContain('Total spent');
    fireEvent.click(arcs()[0]);
    fireEvent.click(arcs()[2]);
    expect(center()).toContain('Tea');
    fireEvent.click(document.body);
    expect(center()).toContain('Total spent');
    fireEvent.click(container.querySelectorAll('.pie-row')[1]);
    expect(center()).toContain('Food');

    // All three categories share one stored colour, yet every slice differs.
    const dots = Array.from(container.querySelectorAll('.pie-dot')).map((e) => (e as HTMLElement).style.background);
    expect(new Set(dots).size).toBe(3);
  });
});

describe('Analytics — donut keeps every category separate', () => {
  it('shows each category as its own slice and legend row with a unique colour (no "Other" bucket)', async () => {
    const bracketId = await makeBracket('spend');
    const date = `${monthKey(todayISO())}-10`;
    const names = ['Rent', 'Food', 'Tea', 'Fuel', 'Gym', 'Movies', 'Books', 'Gifts', 'Phone', 'Water'];
    for (const [i, name] of names.entries()) {
      const id = await db.categories.add({ name, icon: '💳', color: '#F0B94D', budget: 1, bracketId });
      await db.transactions.add({ type: 'expense', amount: 10000 / (i + 1), categoryId: id, date, createdAt: Date.now() });
    }
    const { container } = renderAnalytics();
    await screen.findAllByText('Rent');
    expect(container.querySelectorAll('.pie-arc').length).toBe(10);
    // The legend opens on the top 5 and expands on request — nothing is lost.
    expect(container.querySelectorAll('.pie-row').length).toBe(5);
    fireEvent.click(screen.getByText('Show all 10'));
    expect(container.querySelectorAll('.pie-row').length).toBe(10);
    fireEvent.click(screen.getByText('Show fewer'));
    expect(container.querySelectorAll('.pie-row').length).toBe(5);
    fireEvent.click(screen.getByText('Show all 10'));
    expect(screen.queryByText(/^Other \(/)).not.toBeInTheDocument();
    const dots = Array.from(container.querySelectorAll('.pie-dot')).map((e) => (e as HTMLElement).style.background);
    expect(new Set(dots).size).toBe(10);
  });
});

describe('Analytics — donut legend preview', () => {
  async function seed(n: number) {
    const bracketId = await makeBracket('spend');
    const date = `${monthKey(todayISO())}-10`;
    for (let i = 0; i < n; i++) {
      const id = await db.categories.add({ name: `Cat${i}`, icon: '💳', color: '#F0B94D', budget: 1, bracketId });
      await db.transactions.add({ type: 'expense', amount: 10000 - i * 100, categoryId: id, date, createdAt: Date.now() });
    }
  }

  it('has no toggle when there are 5 or fewer categories', async () => {
    await seed(5);
    const { container } = renderAnalytics();
    await screen.findAllByText('Cat0');
    expect(container.querySelectorAll('.pie-row').length).toBe(5);
    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument();
  });

  it('selecting a slice the collapsed legend hides expands the legend so the selection stays visible', async () => {
    await seed(8);
    const { container } = renderAnalytics();
    await screen.findAllByText('Cat0');
    expect(container.querySelectorAll('.pie-row').length).toBe(5);
    fireEvent.click(container.querySelectorAll('.pie-arc')[7]);
    expect(container.querySelectorAll('.pie-row').length).toBe(8);
    expect(container.querySelector('.pie-row.active')).not.toBeNull();
  });
});

describe('Analytics — vs. last month', () => {
  afterEach(() => vi.useRealTimers());

  async function seedMonths() {
    const bracketId = await makeBracket('spend');
    const food = await db.categories.add({ name: 'Food', icon: '🍲', color: '#6FC98A', budget: 1, bracketId });
    const rent = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 1, bracketId });
    const add = (categoryId: number, amount: number, date: string) =>
      db.transactions.add({ type: 'expense', amount, categoryId, date, createdAt: 0 });
    await add(food, 1000, '2026-09-05');
    await add(food, 500, '2026-09-25'); // after "today" in the month-in-progress case
    await add(rent, 14000, '2026-09-01');
    await add(food, 2500, '2026-10-03');
    await add(rent, 14000, '2026-10-01');
    await add(food, 800, '2026-08-10'); // for the closed-month case
    await add(rent, 14000, '2026-08-01');
  }

  it('compares a month in progress with the same stretch of last month, and lists only the categories that moved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    await seedMonths();
    renderAnalytics();

    const card = (await screen.findByText(/^Vs\. September 2026/)).closest('.card') as HTMLElement;
    expect(within(card).getByText('day 1–15')).toBeInTheDocument();
    // This month 16,500 vs 15,000 for Sept 1–15 (the 25th is excluded).
    expect(within(card).getByText(fmtMoney(16500, '₹'))).toBeInTheDocument();
    expect(within(card).getByText(`vs ${fmtMoney(15000, '₹')}`)).toBeInTheDocument();
    expect(within(card).getByText(`▲ ${fmtMoney(1500, '₹')} (10%)`)).toBeInTheDocument();
    expect(within(card).getByText('Food')).toBeInTheDocument();
    expect(within(card).queryByText('Rent')).not.toBeInTheDocument(); // unchanged
  });

  it('compares a closed month with the whole of the month before it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    await seedMonths();
    renderAnalytics();
    await screen.findByText(/^Vs\. September 2026/);
    fireEvent.click(screen.getByLabelText('Previous month'));

    const card = (await screen.findByText(/^Vs\. August 2026/)).closest('.card') as HTMLElement;
    expect(within(card).getByText('full month')).toBeInTheDocument();
    expect(within(card).getByText(fmtMoney(15500, '₹'))).toBeInTheDocument(); // Sept in full
    expect(within(card).getByText(`vs ${fmtMoney(14800, '₹')}`)).toBeInTheDocument();
  });

  it('is hidden when last month has nothing to compare against', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12));
    const bracketId = await makeBracket('spend');
    const food = await db.categories.add({ name: 'Food', icon: '🍲', color: '#6FC98A', budget: 1, bracketId });
    await db.transactions.add({ type: 'expense', amount: 700, categoryId: food, date: '2026-10-03', createdAt: 0 });
    renderAnalytics();
    await screen.findAllByText('Food');
    expect(screen.queryByText(/^Vs\./)).not.toBeInTheDocument();
  });
});
