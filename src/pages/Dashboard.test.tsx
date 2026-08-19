import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
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

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard currency="₹" />
    </MemoryRouter>,
  );
}

async function makeBracket(kind: 'spend' | 'allocation' | 'income', name = 'Expenditure') {
  return db.brackets.add({ name, icon: '💳', color: '#7C93F0', kind });
}

describe('Dashboard — budget cap scoping', () => {
  it('excludes allocation-category transactions (Savings) from Spent/Remaining, counting only spend-category transactions', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket('spend', 'Expenditure');
    const savingsBracketId = await makeBracket('allocation', 'Savings');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    const savingsId = await db.categories.add({ name: 'Savings', icon: '💰', color: '#4FD9B8', budget: 5000, bracketId: savingsBracketId });

    await db.transactions.add({ type: 'expense', amount: 8000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });
    // A transfer into Savings — real money moved, but not spend against the cap.
    await db.transactions.add({ type: 'expense', amount: 5000, categoryId: savingsId, date: thisMonthDate, createdAt: Date.now() });

    renderDashboard();

    // "Spent" must reflect only the Rent transaction (8000), not 8000+5000.
    // (The figure also appears in the "Budget health" copy below the ring,
    // hence AllBy rather than By.)
    expect((await screen.findAllByText(fmtMoney(8000, '₹'))).length).toBeGreaterThan(0);
    // "Remaining" = budget cap (20000, Savings' target excluded) − spent (8000).
    expect((await screen.findAllByText(fmtMoney(12000, '₹'))).length).toBeGreaterThan(0);

    // Savings never appears in the "By category" budget list — though it
    // legitimately still shows up further down in "Recent transactions"
    // (the transfer really happened, it's just not counted against the cap),
    // so this scopes the check to the By category card specifically.
    const byCategoryHeading = screen.getByText('By category');
    const byCategoryCard = byCategoryHeading.closest('.card') as HTMLElement;
    expect(within(byCategoryCard).queryByText('Savings')).not.toBeInTheDocument();
    expect(within(byCategoryCard).getByText('Rent')).toBeInTheDocument();
  });

  it('still counts a spend-category transaction normally when there are no allocation categories at all', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket('spend', 'Expenditure');
    const foodId = await db.categories.add({ name: 'Food', icon: '🍲', color: '#6FC98A', budget: 10000, bracketId: expenditureId });
    await db.transactions.add({ type: 'expense', amount: 3000, categoryId: foodId, date: thisMonthDate, createdAt: Date.now() });

    renderDashboard();

    expect((await screen.findAllByText(fmtMoney(3000, '₹'))).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(fmtMoney(7000, '₹'))).length).toBeGreaterThan(0);
  });

  it('aggregates across multiple spend-kind brackets, not just one hardcoded "Expenditure"', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket('spend', 'Expenditure');
    const workId = await makeBracket('spend', 'Work Expenses');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    const travelId = await db.categories.add({ name: 'Travel', icon: '✈️', color: '#F0A83E', budget: 5000, bracketId: workId });
    await db.transactions.add({ type: 'expense', amount: 8000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });
    await db.transactions.add({ type: 'expense', amount: 2000, categoryId: travelId, date: thisMonthDate, createdAt: Date.now() });

    renderDashboard();

    expect((await screen.findAllByText(fmtMoney(10000, '₹'))).length).toBeGreaterThan(0); // total spent
    expect((await screen.findAllByText(fmtMoney(25000, '₹'))).length).toBeGreaterThan(0); // total budget cap
  });

  it('never shows an Income tile or any income-derived figure, since Budget only knows about the spending cap', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket('spend', 'Expenditure');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    await db.transactions.add({ type: 'expense', amount: 8000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });

    renderDashboard();

    expect(await screen.findByText('Budgeted')).toBeInTheDocument();
    expect(screen.queryByText('Income')).not.toBeInTheDocument();
  });

  it('excludes an archived category\'s budget from the total cap, matching Home and BracketDetail', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket('spend', 'Expenditure');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    const oldGymId = await db.categories.add({
      name: 'Gym (old)', icon: '🏋️', color: '#F0B94D', budget: 3000, bracketId: expenditureId, archived: true,
    });

    await db.transactions.add({ type: 'expense', amount: 8000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });
    // Historical spend against the now-archived category should still
    // count as spend this month — archiving stops future budgeting, it
    // doesn't erase what already happened.
    await db.transactions.add({ type: 'expense', amount: 1000, categoryId: oldGymId, date: thisMonthDate, createdAt: Date.now() });

    renderDashboard();

    // Budget cap: only Rent's 20000 — the archived Gym category's 3000
    // budget must not still be counted (previously it was, unlike Home
    // and BracketDetail which already excluded archived categories).
    // Spent: 8000 + 1000 = 9000. Remaining: 20000 − 9000 = 11000.
    expect((await screen.findAllByText(fmtMoney(9000, '₹'))).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(fmtMoney(11000, '₹'))).length).toBeGreaterThan(0);

    const byCategoryHeading = screen.getByText('By category');
    const byCategoryCard = byCategoryHeading.closest('.card') as HTMLElement;
    expect(within(byCategoryCard).queryByText('Gym (old)')).not.toBeInTheDocument();
  });
});
