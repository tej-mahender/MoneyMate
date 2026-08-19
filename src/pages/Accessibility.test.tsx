import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import Dashboard from './Dashboard';
import Overview from './Overview';
import Settings from './Settings';
import AddTransaction from './AddTransaction';
import BracketDetail from './BracketDetail';
import { db, type Settings as SettingsType } from '../db/db';
import { monthKey, todayISO } from '../lib/format';

expect.extend(toHaveNoViolations);

// jsdom has no real layout/paint engine, so axe's color-contrast rule
// produces unreliable results here (it needs actual rendered geometry).
// Contrast should be checked visually against the deployed build or an
// Android WebView instead — this audit covers everything axe *can*
// meaningfully verify without a real renderer: labeling, roles, landmark
// structure, form-field association, button naming, etc.
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

const baseSettings: SettingsType = {
  id: 1,
  onboarded: true,
  currency: '₹',
  theme: 'dark',
  monthlyIncome: 50000,
  carryForward: false,
  hideWidgetAmounts: false,
};

async function seedTypicalData() {
  const thisMonthDate = `${monthKey(todayISO())}-10`;
  const expenditureId = await db.brackets.add({ name: 'Expenditure', icon: '💳', color: '#7C93F0', kind: 'spend' });
  const savingsBracketId = await db.brackets.add({ name: 'Savings', icon: '💰', color: '#4FD9B8', kind: 'allocation' });
  const incomeBracketId = await db.brackets.add({ name: 'Income', icon: '💼', color: '#6FC98A', kind: 'income' });
  const rentId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: expenditureId });
  const savingsId = await db.categories.add({ name: 'Savings', icon: '💰', color: '#4FD9B8', budget: 10000, bracketId: savingsBracketId });
  await db.categories.add({ name: 'Salary', icon: '💼', color: '#4FD9B8', budget: 0, bracketId: incomeBracketId });
  await db.transactions.add({ type: 'expense', amount: 15000, categoryId: rentId, date: thisMonthDate, createdAt: Date.now() });
  await db.transactions.add({ type: 'expense', amount: 5000, categoryId: savingsId, date: thisMonthDate, createdAt: Date.now() });
  return { expenditureId, savingsBracketId, incomeBracketId };
}

describe('accessibility — Dashboard (Budget)', () => {
  it('has no automatically detectable a11y violations, empty state', async () => {
    const { container } = render(
      <MemoryRouter>
        <Dashboard currency="₹" />
      </MemoryRouter>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no automatically detectable a11y violations, populated with budgeted + allocation data', async () => {
    await seedTypicalData();
    const { container } = render(
      <MemoryRouter>
        <Dashboard currency="₹" />
      </MemoryRouter>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('accessibility — Home (Overview)', () => {
  it('has no automatically detectable a11y violations, empty state', async () => {
    const { container } = render(
      <MemoryRouter>
        <Overview currency="₹" monthlyIncome={0} />
      </MemoryRouter>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no automatically detectable a11y violations, populated with brackets', async () => {
    await seedTypicalData();
    const { container } = render(
      <MemoryRouter>
        <Overview currency="₹" monthlyIncome={50000} />
      </MemoryRouter>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('accessibility — Settings', () => {
  it('has no automatically detectable a11y violations, including the bracket-add form', async () => {
    await seedTypicalData();
    const { container } = render(
      <MemoryRouter>
        <Settings settings={baseSettings} onSettingsChange={() => {}} />
      </MemoryRouter>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('accessibility — BracketDetail', () => {
  it('has no automatically detectable a11y violations on a spend bracket', async () => {
    const { expenditureId } = await seedTypicalData();
    const { container } = render(
      <MemoryRouter initialEntries={[`/bracket/${expenditureId}`]}>
        <Routes>
          <Route path="/bracket/:id" element={<BracketDetail currency="₹" monthlyIncome={50000} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it('has no automatically detectable a11y violations on the Income bracket', async () => {
    const { incomeBracketId } = await seedTypicalData();
    const { container } = render(
      <MemoryRouter initialEntries={[`/bracket/${incomeBracketId}`]}>
        <Routes>
          <Route path="/bracket/:id" element={<BracketDetail currency="₹" monthlyIncome={50000} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe('accessibility — AddTransaction', () => {
  it('has no automatically detectable a11y violations on the entry form', async () => {
    await seedTypicalData();
    const { container } = render(
      <MemoryRouter>
        <AddTransaction />
      </MemoryRouter>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
