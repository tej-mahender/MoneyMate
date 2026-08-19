import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Overview from './Overview';
import { db, type BracketKind } from '../db/db';
import { fmtMoney, monthKey, todayISO } from '../lib/format';

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

function renderHome(monthlyIncome: number) {
  return render(
    <MemoryRouter>
      <Overview currency="₹" monthlyIncome={monthlyIncome} />
    </MemoryRouter>,
  );
}

async function makeBracket(name: string, kind: BracketKind, icon = '💳', color = '#7C93F0') {
  return db.brackets.add({ name, icon, color, kind });
}

describe('Home — no brackets at all', () => {
  it('shows an empty state pointing to Settings', async () => {
    renderHome(0);
    expect(await screen.findByText(/No brackets yet/i)).toBeInTheDocument();
  });
});

describe('Home — no income set', () => {
  it('skips the Income/Allocated/Unallocated tiles and shows a prompt pointing to Settings instead', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-10`;
    const expenditureId = await makeBracket('Expenditure', 'spend');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    await db.transactions.add({ type: 'expense', amount: 5000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });

    renderHome(0);

    expect(screen.queryByText('Income')).not.toBeInTheDocument();
    expect(screen.queryByText('Unallocated')).not.toBeInTheDocument();
    expect(screen.getByText(/No income set/i)).toBeInTheDocument();
    // The Expenditure bracket's own row still shows its numbers regardless.
    expect(await screen.findByText('Expenditure')).toBeInTheDocument();
    expect(screen.getByText(/5,000 spent of/)).toBeInTheDocument();
  });

  it('switches to Income/Allocated/Unallocated once a logged income transaction alone (no fixed income) pushes total income above 0', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-10`;
    const incomeBracketId = await makeBracket('Income', 'income');
    const freelanceId = await db.categories.add({ name: 'Freelance', icon: '🧾', color: '#7C93F0', budget: 0, bracketId: incomeBracketId });
    await db.transactions.add({ type: 'income', amount: 15000, categoryId: freelanceId, date: thisMonthDate, createdAt: Date.now() });

    renderHome(0); // no fixed monthly income, only a logged transaction

    expect((await screen.findAllByText('Income')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unallocated').length).toBeGreaterThan(0);
    expect(screen.queryByText(/No income set/i)).not.toBeInTheDocument();
  });
});

describe('Home — bracket cards', () => {
  it('rolls up income, an arbitrary number of allocation brackets (Savings/Investments/EMI as separate brackets, not flat categories), unbudgeted spend, and the unallocated remainder', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-10`;

    const expenditureId = await makeBracket('Expenditure', 'spend');
    const savingsBracketId = await makeBracket('Savings', 'allocation');
    const emiBracketId = await makeBracket('EMI', 'allocation');

    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    // A spend category with budget 0 — deliberately uncapped/ad-hoc spend.
    const miscId = await db.categories.add({ name: 'Misc', icon: '🧾', color: '#B98CF0', budget: 0, bracketId: expenditureId });
    const savingsId = await db.categories.add({ name: 'Savings', icon: '💰', color: '#4FD9B8', budget: 10000, bracketId: savingsBracketId });
    const emiId = await db.categories.add({ name: 'Car EMI', icon: '🏦', color: '#E8618C', budget: 8000, bracketId: emiBracketId });

    await db.transactions.add({ type: 'expense', amount: 15000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });
    await db.transactions.add({ type: 'expense', amount: 1200, categoryId: miscId, date: thisMonthDate, createdAt: Date.now() });
    await db.transactions.add({ type: 'expense', amount: 10000, categoryId: savingsId, date: thisMonthDate, createdAt: Date.now() });
    // EMI actual spend below its target, to check target-vs-actual isn't conflated.
    await db.transactions.add({ type: 'expense', amount: 6000, categoryId: emiId, date: thisMonthDate, createdAt: Date.now() });

    const monthlyIncome = 80000;
    renderHome(monthlyIncome);

    // Income tile: no separately-logged income tx this month, so just the
    // fixed monthly income.
    expect(await screen.findByText(fmtMoney(80000, '₹'))).toBeInTheDocument();

    // Allocated tile: what's been given a job, planned not actual — spend
    // cap (20000, Misc's 0 budget excluded) + allocation targets (10000 +
    // 8000), the complement of the Unallocated figure below. Deliberately
    // not the 16000 actually moved (10000 + 6000) — a target should read as
    // allocated as soon as it's set, not only once money has moved.
    expect(await screen.findByText(fmtMoney(38000, '₹'))).toBeInTheDocument();

    // Both allocation brackets render individually — arbitrary buckets,
    // not a hardcoded Savings/Investments pair.
    expect(await screen.findByText('Savings')).toBeInTheDocument();
    expect(await screen.findByText('EMI')).toBeInTheDocument();

    // Unallocated = income (80000) − budget cap (20000, Misc's 0 budget
    // excluded) − allocation targets (10000 + 8000) = 42000.
    expect(await screen.findByText(fmtMoney(42000, '₹'))).toBeInTheDocument();

    // Other/unbudgeted spend section shows Misc's 1200, called out
    // separately rather than silently folded into "budgeted spend".
    expect(await screen.findByText(fmtMoney(1200, '₹'))).toBeInTheDocument();
    expect(screen.getByText(/1 transaction/)).toBeInTheDocument();
  });

  it('shows the "nothing outside budgeted categories" empty state when there is no unbudgeted spend', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-10`;
    const expenditureId = await makeBracket('Expenditure', 'spend');
    const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
    await db.transactions.add({ type: 'expense', amount: 5000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });

    renderHome(50000);

    expect(await screen.findByText(/Nothing outside your budgeted categories/i)).toBeInTheDocument();
  });

  it('a bracket with no categories yet shows "no target set" rather than crashing on an empty sum', async () => {
    await makeBracket('Investments', 'allocation');
    renderHome(50000);
    expect(await screen.findByText('Investments')).toBeInTheDocument();
    expect(screen.getByText(/no target set/i)).toBeInTheDocument();
  });
});
