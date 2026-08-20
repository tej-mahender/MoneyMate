import { describe, it, expect } from 'vitest';
import { computeGeneralAdjustment } from './budgetLogic';
import type { Category } from '../db/db';

describe('computeGeneralAdjustment', () => {
  const general: Category = { id: 1, name: 'General', icon: '💳', color: '#7C93F0', budget: 23000, bracketId: 1 };

  it('shrinks General when a brand-new category is added with a budget', () => {
    const draft: Category[] = [
      general,
      { name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 5000, bracketId: 1 }, // new — no id
    ];
    const result = computeGeneralAdjustment([general], draft);
    expect(result).toEqual({ generalId: 1, oldBudget: 23000, newBudget: 18000, newlyAddedBudget: 5000 });
  });

  it('shrinks General when an EXISTING zero-budget starter category (e.g. Expenditure\'s pre-seeded "Food") is given a real budget for the first time', () => {
    // This is the actual real-world case: Expenditure always seeds Rent,
    // Food, etc. at ₹0 alongside General during onboarding. Filling one of
    // those in isn't "adding a new category" (it already has a db id) —
    // but it's just as much drawing from the unassigned pool as a brand
    // new row would be, and must shrink General the same way.
    const foodOriginal: Category = { id: 9, name: 'Food', icon: '🍔', color: '#F0B94D', budget: 0, bracketId: 1 };
    const foodDraft = { ...foodOriginal, budget: 9000 };
    const result = computeGeneralAdjustment([general, foodOriginal], [general, foodDraft]);
    expect(result).toEqual({ generalId: 1, oldBudget: 23000, newBudget: 14000, newlyAddedBudget: 9000 });
  });

  it('shrinks General when an already-budgeted existing category is increased further', () => {
    // Not just 0 → something — any increase on any other category draws
    // from the unassigned pool, since that's what General represents.
    const rentOriginal: Category = { id: 9, name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 5000, bracketId: 1 };
    const rentDraft = { ...rentOriginal, budget: 8000 };
    const result = computeGeneralAdjustment([general, rentOriginal], [general, rentDraft]);
    expect(result).toEqual({ generalId: 1, oldBudget: 23000, newBudget: 20000, newlyAddedBudget: 3000 });
  });

  it('sums increases across multiple categories in the same save', () => {
    const rentOriginal: Category = { id: 9, name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 0, bracketId: 1 };
    const foodOriginal: Category = { id: 10, name: 'Food', icon: '🍔', color: '#F0B94D', budget: 0, bracketId: 1 };
    const rentDraft = { ...rentOriginal, budget: 5000 };
    const foodDraft = { ...foodOriginal, budget: 9000 };
    const result = computeGeneralAdjustment(
      [general, rentOriginal, foodOriginal],
      [general, rentDraft, foodDraft],
    );
    expect(result).toEqual({ generalId: 1, oldBudget: 23000, newBudget: 9000, newlyAddedBudget: 14000 });
  });

  it('does NOT refund into General when a category\'s budget is decreased — only increases pull from it', () => {
    const rentOriginal: Category = { id: 9, name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 5000, bracketId: 1 };
    const rentDraft = { ...rentOriginal, budget: 2000 };
    const result = computeGeneralAdjustment([general, rentOriginal], [general, rentDraft]);
    expect(result).toBeNull();
  });

  it('nets a decrease on one category against an increase on another within the same save', () => {
    const rentOriginal: Category = { id: 9, name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 5000, bracketId: 1 };
    const foodOriginal: Category = { id: 10, name: 'Food', icon: '🍔', color: '#F0B94D', budget: 0, bracketId: 1 };
    const rentDraft = { ...rentOriginal, budget: 3000 }; // -2000, doesn't count
    const foodDraft = { ...foodOriginal, budget: 6000 }; // +6000
    const result = computeGeneralAdjustment(
      [general, rentOriginal, foodOriginal],
      [general, rentDraft, foodDraft],
    );
    expect(result).toEqual({ generalId: 1, oldBudget: 23000, newBudget: 17000, newlyAddedBudget: 6000 });
  });

  it('clamps General at 0 rather than going negative when more is added than it has left', () => {
    const almostEmptyGeneral = { ...general, budget: 3000 };
    const draft: Category[] = [
      almostEmptyGeneral,
      { name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 5000, bracketId: 1 },
    ];
    const result = computeGeneralAdjustment([almostEmptyGeneral], draft);
    expect(result).toEqual({ generalId: 1, oldBudget: 3000, newBudget: 0, newlyAddedBudget: 5000 });
  });

  it('returns null when nothing increased at all', () => {
    const draft: Category[] = [general];
    expect(computeGeneralAdjustment([general], draft)).toBeNull();
  });

  it("returns null when there's no General category in the bracket at all", () => {
    const draft: Category[] = [{ name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 5000, bracketId: 1 }];
    expect(computeGeneralAdjustment([], draft)).toBeNull();
  });

  it("returns null (doesn't override) when the person already typed their own new value into General in this same edit", () => {
    const manuallyEditedGeneral = { ...general, budget: 12000 }; // person typed this themselves
    const draft: Category[] = [
      manuallyEditedGeneral,
      { name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 5000, bracketId: 1 },
    ];
    // original (pre-edit) General was still 23000 — draft no longer matches it.
    const result = computeGeneralAdjustment([general], draft);
    expect(result).toBeNull();
  });

  it('returns null when the row with a budget has no name (an empty draft row shouldn\'t trigger anything)', () => {
    const draft: Category[] = [general, { name: '  ', icon: '🏠', color: '#F0B94D', budget: 5000, bracketId: 1 }];
    expect(computeGeneralAdjustment([general], draft)).toBeNull();
  });

  it('ignores a category merely named "General" that has no id yet (a brand-new row, not the real placeholder)', () => {
    // Someone typing "General" as the name of a fresh row they're adding —
    // not the actual persisted starter category — must never match.
    const draft: Category[] = [{ name: 'General', icon: '💳', color: '#7C93F0', budget: 1000, bracketId: 1 }];
    expect(computeGeneralAdjustment([], draft)).toBeNull();
  });
});
