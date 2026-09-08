import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
