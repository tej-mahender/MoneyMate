import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import BracketDetail from './BracketDetail';
import { db } from '../db/db';
import { monthKey, todayISO } from '../lib/format';

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderBracket(id: number) {
  return render(
    <MemoryRouter initialEntries={[`/bracket/${id}`]}>
      <Routes>
        <Route path="/bracket/:id" element={<BracketDetail currency="₹" monthlyIncome={0} />} />
        <Route path="/settings" element={<div>Settings screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function makeBracket(name: string, kind: 'spend' | 'allocation' | 'income' = 'allocation') {
  return db.brackets.add({ name, icon: '💰', color: '#4FD9B8', kind });
}

// Categories render as a clean read-first list by default (CategoryRow) —
// editing (rename/rebudget/remove/add) lives behind an explicit toggle so
// the everyday browsing view isn't a permanently-open form.
async function enterEditMode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Edit categories' }));
}

describe('BracketDetail — archive/delete a bracket', () => {
  it('archiving an empty bracket sets archived=true and navigates back to Settings, with no confirm prompt needed', async () => {
    const id = await makeBracket('Unused Bracket');
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Archive bracket'));

    const bracket = await db.brackets.get(id);
    expect(bracket?.archived).toBe(true);
    expect(await screen.findByText('Settings screen')).toBeInTheDocument();
  });

  it('deleting an empty bracket, confirmed, removes it entirely', async () => {
    const id = await makeBracket('Unused Bracket');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Delete bracket'));

    await waitFor(async () => expect(await db.brackets.get(id)).toBeUndefined());
    expect(await screen.findByText('Settings screen')).toBeInTheDocument();
  });

  it('deleting an empty bracket, cancelled at the confirm, leaves it untouched', async () => {
    const id = await makeBracket('Unused Bracket');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Delete bracket'));

    expect(await db.brackets.get(id)).toBeDefined();
  });

  it('a bracket with categories: declining the delete-confirm falls back to archiving (bracket AND its categories survive, just hidden)', async () => {
    const id = await makeBracket('Savings');
    const catId = await db.categories.add({ name: 'Emergency Fund', icon: '💰', color: '#4FD9B8', budget: 5000, bracketId: id });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Delete bracket'));

    const bracket = await db.brackets.get(id);
    expect(bracket?.archived).toBe(true);
    expect(await db.categories.get(catId)).toBeDefined();
  });

  it('a bracket with categories and transactions: confirming the delete cascades to its categories, leaving their transactions pointing at a now-deleted category (shown as Uncategorized elsewhere in the app)', async () => {
    const id = await makeBracket('Savings');
    const catId = await db.categories.add({ name: 'Emergency Fund', icon: '💰', color: '#4FD9B8', budget: 5000, bracketId: id });
    await db.transactions.add({ type: 'expense', amount: 1000, categoryId: catId, date: '2026-08-05', createdAt: Date.now() });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Delete bracket'));

    await waitFor(async () => expect(await db.brackets.get(id)).toBeUndefined());
    expect(await db.categories.get(catId)).toBeUndefined();
    const tx = await db.transactions.toArray();
    expect(tx).toHaveLength(1);
    expect(tx[0].categoryId).toBe(catId);
  });
});

describe('BracketDetail — read-first category list', () => {
  it('shows categories as a clean read-only list by default — no input fields, no remove buttons', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: id });

    renderBracket(id);

    expect(await screen.findByText('Rent')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Category')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Budget')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('a category with no budget and no spend shows a quiet "Not budgeted yet" line, not a repeated "₹0 spent" figure', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 0, bracketId: id });
    await db.categories.add({ name: 'Food', icon: '🍔', color: '#F0B94D', budget: 0, bracketId: id });

    renderBracket(id);

    await screen.findByText('Rent');
    expect((await screen.findAllByText('Not budgeted yet')).length).toBe(2);
    expect(screen.queryByText(/spent this month/)).not.toBeInTheDocument();
  });

  it('a category with a real budget shows spent-of-budget, even with nothing spent yet', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: id });

    renderBracket(id);

    await screen.findByText('Rent');
    expect(
      await screen.findByText((_, el) => el?.className === 'figs' && el.textContent === '₹0 / ₹20,000'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Not budgeted yet')).not.toBeInTheDocument();
  });

  it('a category with real spend but no budget shows the amount, not "Not budgeted yet"', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    const catId = await db.categories.add({ name: 'Misc', icon: '💳', color: '#F0B94D', budget: 0, bracketId: id });
    await db.transactions.add({ type: 'expense', amount: 500, categoryId: catId, date: `${monthKey(todayISO())}-05`, createdAt: Date.now() });

    renderBracket(id);

    expect(
      await screen.findByText((_, el) => el?.className === 'figs' && el.textContent === '₹500'),
    ).toBeInTheDocument();
    expect(await screen.findByText('unbudgeted')).toBeInTheDocument();
    expect(screen.queryByText('Not budgeted yet')).not.toBeInTheDocument();
  });

  it('the Income bracket lists categories with "logged" amounts, not budget/percentage language', async () => {
    const id = await makeBracket('Income', 'income');
    const catId = await db.categories.add({ name: 'Salary', icon: '💼', color: '#6FC98A', budget: 0, bracketId: id });
    await db.transactions.add({ type: 'income', amount: 50000, categoryId: catId, date: `${monthKey(todayISO())}-01`, createdAt: Date.now() });

    renderBracket(id);

    expect(await screen.findByText('Salary')).toBeInTheDocument();
    expect(
      await screen.findByText((_, el) => el?.className === 'figs' && el.textContent === '₹50,000 logged'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/% used/)).not.toBeInTheDocument();
  });

  it('tapping a category row navigates to its filtered history', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: id });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={[`/bracket/${id}`]}>
        <Routes>
          <Route path="/bracket/:id" element={<BracketDetail currency="₹" monthlyIncome={0} />} />
          <Route path="/history" element={<div>History screen</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByText('Rent'));
    expect(await screen.findByText('History screen')).toBeInTheDocument();
  });
});

describe('BracketDetail — editing categories lives behind an explicit toggle', () => {
  it('clicking "Edit categories" reveals the inline form; clicking Done saves and returns to the read list', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: id });
    const user = userEvent.setup();
    renderBracket(id);

    await screen.findByText('Rent');
    expect(screen.queryByPlaceholderText('Category')).not.toBeInTheDocument();

    await enterEditMode(user);
    expect(await screen.findByPlaceholderText('Category')).toBeInTheDocument();

    await user.click(screen.getByText('Done'));
    await waitFor(() => expect(screen.queryByPlaceholderText('Category')).not.toBeInTheDocument());
    expect(await screen.findByText('Rent')).toBeInTheDocument();
  });

  it('renaming a category in edit mode persists and shows up in the read list after Done', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 20000, bracketId: id });
    const user = userEvent.setup();
    renderBracket(id);

    await enterEditMode(user);
    const nameInput = await screen.findByDisplayValue('Rent');
    await user.clear(nameInput);
    await user.type(nameInput, 'Housing');
    await user.click(screen.getByText('Done'));

    expect(await screen.findByText('Housing')).toBeInTheDocument();
    expect(screen.queryByText('Rent')).not.toBeInTheDocument();
  });
});

describe('BracketDetail — draftCats stays in sync with the DB, not just the id set', () => {
  it("General category's own input reflects its shrunk budget immediately after Done — not just after leaving and returning to the page", async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'General', icon: '💳', color: '#7C93F0', budget: 23000, bracketId: id });
    await db.categories.add({ name: 'Food', icon: '🍔', color: '#F0B94D', budget: 0, bracketId: id });
    const user = userEvent.setup();
    renderBracket(id);

    await enterEditMode(user);
    const budgetInputs = await screen.findAllByPlaceholderText('Budget');
    const foodBudgetInput = budgetInputs[budgetInputs.length - 1];
    await user.clear(foodBudgetInput);
    await user.type(foodBudgetInput, '9000');
    await user.click(screen.getByText('Done'));

    await waitFor(() => {
      const budgetedValue = screen.getByText('Budgeted').closest('div')?.parentElement?.querySelector('.value');
      expect(budgetedValue?.textContent).toBe('₹23,000');
    });
    await enterEditMode(user);
    await waitFor(() => {
      expect(screen.getByDisplayValue('14000')).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('23000')).not.toBeInTheDocument();
  });
});

describe('BracketDetail — General auto-shrinks when a real category is added', () => {
  it('filling in an EXISTING ₹0 starter category (e.g. onboarding\'s pre-seeded "Food") shrinks General too, not just a brand-new row', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'General', icon: '💳', color: '#7C93F0', budget: 23000, bracketId: id });
    await db.categories.add({ name: 'Food', icon: '🍔', color: '#F0B94D', budget: 0, bracketId: id });
    const user = userEvent.setup();
    renderBracket(id);

    await enterEditMode(user);
    const budgetInputs = await screen.findAllByPlaceholderText('Budget');
    const foodBudgetInput = budgetInputs[budgetInputs.length - 1];
    await user.clear(foodBudgetInput);
    await user.type(foodBudgetInput, '9000');
    await user.click(screen.getByText('Done'));

    await waitFor(async () => {
      const cats = await db.categories.where('bracketId').equals(id).toArray();
      const food = cats.find((c) => c.name === 'Food');
      const gen = cats.find((c) => c.name === 'General');
      expect(food?.budget).toBe(9000);
      expect(gen?.budget).toBe(14000);
      expect(gen?.archived).toBeFalsy();
      expect(cats.filter((c) => !c.archived).reduce((s, c) => s + c.budget, 0)).toBe(23000);
    });
  });

  it('adding "Rent" shrinks General by the same amount, keeping the bracket total unchanged', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'General', icon: '💳', color: '#7C93F0', budget: 23000, bracketId: id });
    const user = userEvent.setup();
    renderBracket(id);

    await enterEditMode(user);
    await user.click(screen.getByText('+ Add category'));
    const nameInputs = await screen.findAllByPlaceholderText('Category');
    const budgetInputs = screen.getAllByPlaceholderText('Budget');
    await user.type(nameInputs[nameInputs.length - 1], 'Rent');
    await user.type(budgetInputs[budgetInputs.length - 1], '5000');
    await user.click(screen.getByText('Done'));

    await waitFor(async () => {
      const cats = await db.categories.where('bracketId').equals(id).toArray();
      const rent = cats.find((c) => c.name === 'Rent');
      const gen = cats.find((c) => c.name === 'General');
      expect(rent?.budget).toBe(5000);
      expect(gen?.budget).toBe(18000);
      expect(gen?.archived).toBeFalsy();
    });
  });

  it('draining General to exactly 0 archives it, so it drops out of the read-mode category list', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'General', icon: '💳', color: '#7C93F0', budget: 5000, bracketId: id });
    const user = userEvent.setup();
    renderBracket(id);

    await enterEditMode(user);
    await user.click(screen.getByText('+ Add category'));
    const nameInputs = await screen.findAllByPlaceholderText('Category');
    const budgetInputs = screen.getAllByPlaceholderText('Budget');
    await user.type(nameInputs[nameInputs.length - 1], 'Rent');
    await user.type(budgetInputs[budgetInputs.length - 1], '5000');
    await user.click(screen.getByText('Done'));

    await waitFor(async () => {
      const gen = await db.categories.where({ bracketId: id, name: 'General' }).first();
      expect(gen?.budget).toBe(0);
      expect(gen?.archived).toBe(true);
    });
    await waitFor(() => expect(screen.queryByText('General')).not.toBeInTheDocument());
    expect(await screen.findByText('Rent')).toBeInTheDocument();
  });

  it('adding more than General has left raises the total for the shortfall, rather than silently capping the new category', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    await db.categories.add({ name: 'General', icon: '💳', color: '#7C93F0', budget: 3000, bracketId: id });
    const user = userEvent.setup();
    renderBracket(id);

    await enterEditMode(user);
    await user.click(screen.getByText('+ Add category'));
    const nameInputs = await screen.findAllByPlaceholderText('Category');
    const budgetInputs = screen.getAllByPlaceholderText('Budget');
    await user.type(nameInputs[nameInputs.length - 1], 'Rent');
    await user.type(budgetInputs[budgetInputs.length - 1], '5000');
    await user.click(screen.getByText('Done'));

    await waitFor(async () => {
      const cats = await db.categories.where('bracketId').equals(id).toArray();
      const rent = cats.find((c) => c.name === 'Rent');
      const gen = cats.find((c) => c.name === 'General');
      expect(rent?.budget).toBe(5000);
      expect(gen?.budget).toBe(0);
      expect(gen?.archived).toBe(true);
      expect(cats.filter((c) => !c.archived).reduce((s, c) => s + c.budget, 0)).toBe(5000);
    });
  });
});

describe('BracketDetail — the same auto-shrink applies to Savings/Investments\' bracket-named lump category', () => {
  it('adding "Gold" under Investments shrinks the lone "Investments" lump category, not just a category literally named "General"', async () => {
    const id = await makeBracket('Investments', 'allocation');
    await db.categories.add({ name: 'Investments', icon: '📈', color: '#B98CF0', budget: 30000, bracketId: id });
    const user = userEvent.setup();
    renderBracket(id);

    await enterEditMode(user);
    await user.click(screen.getByText('+ Add category'));
    const nameInputs = await screen.findAllByPlaceholderText('Category');
    const budgetInputs = screen.getAllByPlaceholderText('Target');
    await user.type(nameInputs[nameInputs.length - 1], 'Gold');
    await user.type(budgetInputs[budgetInputs.length - 1], '10000');
    await user.click(screen.getByText('Done'));

    await waitFor(async () => {
      const cats = await db.categories.where('bracketId').equals(id).toArray();
      const gold = cats.find((c) => c.name === 'Gold');
      const lump = cats.find((c) => c.name === 'Investments');
      expect(gold?.budget).toBe(10000);
      expect(lump?.budget).toBe(20000);
      expect(lump?.archived).toBeFalsy();
      expect(cats.filter((c) => !c.archived).reduce((s, c) => s + c.budget, 0)).toBe(30000);
    });
  });
});

describe('BracketDetail — hero ring: exceeding 100% means opposite things for spend vs. allocation', () => {
  it('overspending a spend-kind budget shows red "over budget" — a bad outcome', async () => {
    const id = await makeBracket('Expenditure', 'spend');
    const catId = await db.categories.add({ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 10000, bracketId: id });
    await db.transactions.add({ type: 'expense', amount: 12000, categoryId: catId, date: `${monthKey(todayISO())}-05`, createdAt: Date.now() });

    renderBracket(id);

    expect(await screen.findByText('120%')).toBeInTheDocument();
    expect(await screen.findByText(/over budget/)).toBeInTheDocument();
  });

  it('exceeding an allocation (Savings) target shows a positive "nice work" message, not a red "over"', async () => {
    const id = await makeBracket('Savings', 'allocation');
    const catId = await db.categories.add({ name: 'Emergency Fund', icon: '💰', color: '#4FD9B8', budget: 10000, bracketId: id });
    await db.transactions.add({ type: 'expense', amount: 12000, categoryId: catId, date: `${monthKey(todayISO())}-05`, createdAt: Date.now() });

    renderBracket(id);

    expect(await screen.findByText(/target met/)).toBeInTheDocument();
    expect(await screen.findByText(/nice work/)).toBeInTheDocument();
    expect(screen.queryByText(/over budget/)).not.toBeInTheDocument();
  });

  it('shows no hero card at all when the bracket has no target set yet, rather than a 0%-forever ring', async () => {
    const id = await makeBracket('Investments', 'allocation');
    renderBracket(id);

    await screen.findByText('Categories');
    expect(screen.queryByText(/of ₹0/)).not.toBeInTheDocument();
  });

  it('the Income bracket never shows the spend/allocation hero ring', async () => {
    const id = await makeBracket('Income', 'income');
    await db.categories.add({ name: 'Salary', icon: '💼', color: '#6FC98A', budget: 0, bracketId: id });

    renderBracket(id);

    await screen.findByText('This month');
    expect(screen.queryByText(/budget used/)).not.toBeInTheDocument();
    expect(screen.queryByText(/target reached/)).not.toBeInTheDocument();
  });
});
