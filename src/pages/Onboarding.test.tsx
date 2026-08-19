import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Onboarding from '../pages/Onboarding';
import { db, getSettings } from '../db/db';

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

/** Walks through steps 0-2 (welcome, currency/income, bracket division),
 *  optionally entering a monthly income along the way, and leaves the UI
 *  sitting on step 3 (sub-categories) ready for the caller to finish from. */
async function getToSubCategoriesStep(user: ReturnType<typeof userEvent.setup>, monthlyIncome?: string) {
  await user.click(await screen.findByText('Get started'));
  if (monthlyIncome) {
    await user.type(screen.getByPlaceholderText('0.00'), monthlyIncome);
  }
  await user.click(screen.getByText('Continue')); // step 1 -> 2 (bracket division)
  await user.click(await screen.findByText('Continue')); // step 2 -> 3 (sub-categories), amounts left blank
}

describe('capability — fresh-install onboarding', () => {
  it('seeds all 4 default brackets, seeds Expenditure categories under the Expenditure bracket, and marks onboarding complete', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);

    await getToSubCategoriesStep(user);
    await user.click(await screen.findByText('Start tracking'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const settings = await getSettings();
    expect(settings.onboarded).toBe(true);

    // All 4 default brackets exist, even though only Expenditure got real
    // sub-categories here — Savings/Investments/Income are ready to use
    // immediately from Home or Settings without a migration later.
    const brackets = await db.brackets.toArray();
    expect(brackets.map((b) => b.name).sort()).toEqual(['Expenditure', 'Income', 'Investments', 'Savings']);
    const expenditureBracket = brackets.find((b) => b.name === 'Expenditure')!;

    const cats = await db.categories.toArray();
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.every((c) => c.bracketId === expenditureBracket.id)).toBe(true);
  });

  it('does not seed income categories when monthly income is left blank (the common "just track spending" path)', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);

    await getToSubCategoriesStep(user); // income left blank
    await user.click(await screen.findByText('Start tracking'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const incomeBracket = await db.brackets.where('name').equals('Income').first();
    const incomeCats = await db.categories.where('bracketId').equals(incomeBracket!.id!).toArray();
    expect(incomeCats).toHaveLength(0);
  });

  it('seeds default income categories under the Income bracket when a monthly income is entered', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);

    await getToSubCategoriesStep(user, '50000');
    await user.click(await screen.findByText('Start tracking'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const incomeBracket = await db.brackets.where('name').equals('Income').first();
    const incomeCats = await db.categories.where('bracketId').equals(incomeBracket!.id!).toArray();
    expect(incomeCats.length).toBeGreaterThan(0);
  });
});

describe('capability — dividing income into brackets (step 2)', () => {
  it('a bracket left with no sub-categories in step 3 falls back to one lump-sum category matching its step-2 amount', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);

    await user.click(await screen.findByText('Get started'));
    await user.type(screen.getByPlaceholderText('0.00'), '80000');
    await user.click(screen.getByText('Continue'));

    // Step 2: put 10000 toward Savings, leave Investments at 0.
    const savingsAmountInput = (await screen.findAllByPlaceholderText('0'))[
      // Expenditure, Savings, Investments in that order
      1
    ];
    await user.type(savingsAmountInput, '10000');
    await user.click(screen.getByText('Continue'));

    // Step 3: don't add any specific Savings sub-categories — just finish.
    await user.click(await screen.findByText('Start tracking'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const savingsBracket = await db.brackets.where('name').equals('Savings').first();
    const savingsCats = await db.categories.where('bracketId').equals(savingsBracket!.id!).toArray();
    expect(savingsCats).toHaveLength(1);
    expect(savingsCats[0].name).toBe('Savings');
    expect(savingsCats[0].budget).toBe(10000);

    // Investments was left at 0 and never subdivided — no fallback category
    // is created for it, matching how an empty allocation bracket already
    // renders fine elsewhere in the app (no target set yet).
    const investmentsBracket = await db.brackets.where('name').equals('Investments').first();
    const investmentsCats = await db.categories.where('bracketId').equals(investmentsBracket!.id!).toArray();
    expect(investmentsCats).toHaveLength(0);
  });

  it('adding specific sub-categories for a bracket in step 3 takes precedence over its step-2 lump sum', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);

    await user.click(await screen.findByText('Get started'));
    await user.click(screen.getByText('Continue')); // no income

    const investmentsAmountInput = (await screen.findAllByPlaceholderText('0'))[2];
    await user.type(investmentsAmountInput, '5000');
    await user.click(screen.getByText('Continue'));

    // Step 3: add a real sub-category under Investments.
    const investmentsHeading = await screen.findByRole('heading', { name: /Investments/ });
    const investmentsCard = investmentsHeading.closest('.card') as HTMLElement;
    const addButtons = screen.getAllByText('+ Add category');
    // Investments is the 3rd bracket card (Expenditure, Savings, Investments).
    await user.click(addButtons[2]);
    const nameInput = investmentsCard.querySelector('input[placeholder="Category"]') as HTMLInputElement;
    await user.type(nameInput, 'Gold');
    const budgetInput = investmentsCard.querySelector('input[placeholder="Budget"]') as HTMLInputElement;
    await user.type(budgetInput, '3000');

    await user.click(screen.getByText('Start tracking'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const investmentsBracket = await db.brackets.where('name').equals('Investments').first();
    const investmentsCats = await db.categories.where('bracketId').equals(investmentsBracket!.id!).toArray();
    // Only the explicit "Gold" category — not a "5000 lump sum" fallback.
    expect(investmentsCats).toHaveLength(1);
    expect(investmentsCats[0].name).toBe('Gold');
    expect(investmentsCats[0].budget).toBe(3000);
  });

  it('applies the Expenditure step-2 lump sum even though it always arrives at step 3 with pre-filled (blank-budget) category names', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);

    await user.click(await screen.findByText('Get started'));
    await user.click(screen.getByText('Continue')); // no income

    // Step 2: put 20000 toward Expenditure, the 1st bracket amount input.
    const expenditureAmountInput = (await screen.findAllByPlaceholderText('0'))[0];
    await user.type(expenditureAmountInput, '20000');
    await user.click(screen.getByText('Continue'));

    // Step 3: leave the pre-filled Expenditure categories (Rent, Food, …)
    // completely untouched — no per-category budgets entered.
    await user.click(await screen.findByText('Start tracking'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    const expenditureBracket = await db.brackets.where('name').equals('Expenditure').first();
    const expenditureCats = await db.categories.where('bracketId').equals(expenditureBracket!.id!).toArray();

    // The default starter categories are still there, ready to fill in
    // later, plus a "General" category carrying the step-2 lump sum so the
    // bracket's total isn't silently stuck at 0.
    expect(expenditureCats.some((c) => c.name === 'Rent')).toBe(true);
    const general = expenditureCats.find((c) => c.name === 'General');
    expect(general?.budget).toBe(20000);
    expect(expenditureCats.reduce((s, c) => s + c.budget, 0)).toBe(20000);
  });
});
