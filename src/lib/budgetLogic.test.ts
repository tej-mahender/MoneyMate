import { describe, it, expect } from "vitest";
import { computeCatchAllAdjustment } from "./budgetLogic";
import type { Category } from "../db/db";

describe('computeCatchAllAdjustment — "General" (Expenditure-style)', () => {
  const general: Category = {
    id: 1,
    name: "General",
    icon: "💳",
    color: "#7C93F0",
    budget: 23000,
    bracketId: 1,
  };

  it("shrinks General by exactly the newly-added budget when it has enough to cover it", () => {
    const draft: Category[] = [
      general,
      {
        name: "Rent",
        icon: "🏠",
        color: "#F0B94D",
        budget: 5000,
        bracketId: 1,
      }, // new — no id
    ];
    const result = computeCatchAllAdjustment([general], draft, "Expenditure");
    expect(result).toEqual({
      catchAllId: 1,
      catchAllName: "General",
      oldBudget: 23000,
      newBudget: 18000,
      newlyAddedBudget: 5000,
    });
  });

  it('shrinks General when an EXISTING zero-budget starter category (e.g. Expenditure\'s pre-seeded "Food") is given a real budget for the first time', () => {
    // This is the actual real-world case: Expenditure always seeds Rent,
    // Food, etc. at ₹0 alongside General during onboarding. Filling one of
    // those in isn't "adding a new category" (it already has a db id) —
    // but it's just as much drawing from the unassigned pool as a brand
    // new row would be, and must shrink General the same way.
    const foodOriginal: Category = {
      id: 9,
      name: "Food",
      icon: "🍔",
      color: "#F0B94D",
      budget: 0,
      bracketId: 1,
    };
    const foodDraft = { ...foodOriginal, budget: 9000 };
    const result = computeCatchAllAdjustment(
      [general, foodOriginal],
      [general, foodDraft],
      "Expenditure",
    );
    expect(result).toEqual({
      catchAllId: 1,
      catchAllName: "General",
      oldBudget: 23000,
      newBudget: 14000,
      newlyAddedBudget: 9000,
    });
  });

  it("shrinks General when an already-budgeted existing category is increased further", () => {
    const rentOriginal: Category = {
      id: 9,
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 5000,
      bracketId: 1,
    };
    const rentDraft = { ...rentOriginal, budget: 8000 };
    const result = computeCatchAllAdjustment(
      [general, rentOriginal],
      [general, rentDraft],
      "Expenditure",
    );
    expect(result).toEqual({
      catchAllId: 1,
      catchAllName: "General",
      oldBudget: 23000,
      newBudget: 20000,
      newlyAddedBudget: 3000,
    });
  });

  it("sums increases across multiple categories in the same save", () => {
    const rentOriginal: Category = {
      id: 9,
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 0,
      bracketId: 1,
    };
    const foodOriginal: Category = {
      id: 10,
      name: "Food",
      icon: "🍔",
      color: "#F0B94D",
      budget: 0,
      bracketId: 1,
    };
    const rentDraft = { ...rentOriginal, budget: 5000 };
    const foodDraft = { ...foodOriginal, budget: 9000 };
    const result = computeCatchAllAdjustment(
      [general, rentOriginal, foodOriginal],
      [general, rentDraft, foodDraft],
      "Expenditure",
    );
    expect(result).toEqual({
      catchAllId: 1,
      catchAllName: "General",
      oldBudget: 23000,
      newBudget: 9000,
      newlyAddedBudget: 14000,
    });
  });

  it("does NOT refund into General when a category's budget is decreased — only increases pull from it", () => {
    const rentOriginal: Category = {
      id: 9,
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 5000,
      bracketId: 1,
    };
    const rentDraft = { ...rentOriginal, budget: 2000 };
    const result = computeCatchAllAdjustment(
      [general, rentOriginal],
      [general, rentDraft],
      "Expenditure",
    );
    expect(result).toBeNull();
  });

  it("nets a decrease on one category against an increase on another within the same save", () => {
    const rentOriginal: Category = {
      id: 9,
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 5000,
      bracketId: 1,
    };
    const foodOriginal: Category = {
      id: 10,
      name: "Food",
      icon: "🍔",
      color: "#F0B94D",
      budget: 0,
      bracketId: 1,
    };
    const rentDraft = { ...rentOriginal, budget: 3000 }; // -2000, doesn't count
    const foodDraft = { ...foodOriginal, budget: 6000 }; // +6000
    const result = computeCatchAllAdjustment(
      [general, rentOriginal, foodOriginal],
      [general, rentDraft, foodDraft],
      "Expenditure",
    );
    expect(result).toEqual({
      catchAllId: 1,
      catchAllName: "General",
      oldBudget: 23000,
      newBudget: 17000,
      newlyAddedBudget: 6000,
    });
  });

  it("clamps General at 0 rather than going negative when more is added than it has left", () => {
    const almostEmptyGeneral = { ...general, budget: 3000 };
    const draft: Category[] = [
      almostEmptyGeneral,
      {
        name: "Rent",
        icon: "🏠",
        color: "#F0B94D",
        budget: 5000,
        bracketId: 1,
      },
    ];
    const result = computeCatchAllAdjustment(
      [almostEmptyGeneral],
      draft,
      "Expenditure",
    );
    expect(result).toEqual({
      catchAllId: 1,
      catchAllName: "General",
      oldBudget: 3000,
      newBudget: 0,
      newlyAddedBudget: 5000,
    });
  });

  it("returns null when nothing increased at all", () => {
    const draft: Category[] = [general];
    expect(
      computeCatchAllAdjustment([general], draft, "Expenditure"),
    ).toBeNull();
  });

  it("returns null when there's no catch-all category in the bracket at all", () => {
    const draft: Category[] = [
      {
        name: "Rent",
        icon: "🏠",
        color: "#F0B94D",
        budget: 5000,
        bracketId: 1,
      },
    ];
    expect(computeCatchAllAdjustment([], draft, "Expenditure")).toBeNull();
  });

  it("returns null (doesn't override) when the person already typed their own new value into General in this same edit", () => {
    const manuallyEditedGeneral = { ...general, budget: 12000 }; // person typed this themselves
    const draft: Category[] = [
      manuallyEditedGeneral,
      {
        name: "Rent",
        icon: "🏠",
        color: "#F0B94D",
        budget: 5000,
        bracketId: 1,
      },
    ];
    // original (pre-edit) General was still 23000 — draft no longer matches it.
    const result = computeCatchAllAdjustment([general], draft, "Expenditure");
    expect(result).toBeNull();
  });

  it("returns null when the row with a budget has no name (an empty draft row shouldn't trigger anything)", () => {
    const draft: Category[] = [
      general,
      { name: "  ", icon: "🏠", color: "#F0B94D", budget: 5000, bracketId: 1 },
    ];
    expect(
      computeCatchAllAdjustment([general], draft, "Expenditure"),
    ).toBeNull();
  });

  it('ignores a category merely named "General" that has no id yet (a brand-new row, not the real placeholder)', () => {
    // Someone typing "General" as the name of a fresh row they're adding —
    // not the actual persisted starter category — must never match.
    const draft: Category[] = [
      {
        name: "General",
        icon: "💳",
        color: "#7C93F0",
        budget: 1000,
        bracketId: 1,
      },
    ];
    expect(computeCatchAllAdjustment([], draft, "Expenditure")).toBeNull();
  });
});

describe("computeCatchAllAdjustment — bracket-named lump category (Savings/Investments-style)", () => {
  // Savings/Investments' onboarding fallback (no starter categories to sit
  // alongside) creates a single category named after the bracket itself
  // instead of "General" — e.g. a lone "Savings" category holding the
  // whole target. This must shrink exactly the same way General does.
  const savingsLump: Category = {
    id: 5,
    name: "Savings",
    icon: "💰",
    color: "#4FD9B8",
    budget: 30000,
    bracketId: 2,
  };

  it("shrinks the bracket-named lump category when a real sub-category is added", () => {
    const draft: Category[] = [
      savingsLump,
      {
        name: "Emergency Fund",
        icon: "🏦",
        color: "#F0B94D",
        budget: 10000,
        bracketId: 2,
      },
    ];
    const result = computeCatchAllAdjustment([savingsLump], draft, "Savings");
    expect(result).toEqual({
      catchAllId: 5,
      catchAllName: "Savings",
      oldBudget: 30000,
      newBudget: 20000,
      newlyAddedBudget: 10000,
    });
  });

  it("drains and would archive the bracket-named lump category exactly like General", () => {
    const smallLump = { ...savingsLump, budget: 4000 };
    const draft: Category[] = [
      smallLump,
      {
        name: "Gold",
        icon: "🪙",
        color: "#F0A83E",
        budget: 10000,
        bracketId: 2,
      },
    ];
    const result = computeCatchAllAdjustment([smallLump], draft, "Savings");
    expect(result).toEqual({
      catchAllId: 5,
      catchAllName: "Savings",
      oldBudget: 4000,
      newBudget: 0,
      newlyAddedBudget: 10000,
    });
  });

  it("doesn't match a category with some other name — only exactly \"General\" or the bracket's own name", () => {
    const somethingElse: Category = {
      id: 6,
      name: "Misc",
      icon: "💰",
      color: "#4FD9B8",
      budget: 30000,
      bracketId: 2,
    };
    const draft: Category[] = [
      somethingElse,
      {
        name: "Gold",
        icon: "🪙",
        color: "#F0A83E",
        budget: 10000,
        bracketId: 2,
      },
    ];
    expect(
      computeCatchAllAdjustment([somethingElse], draft, "Savings"),
    ).toBeNull();
  });

  it('prefers a category literally named "General" over a bracket-named one if both somehow exist', () => {
    const generalRow: Category = {
      id: 7,
      name: "General",
      icon: "💰",
      color: "#4FD9B8",
      budget: 5000,
      bracketId: 2,
    };
    const draft: Category[] = [
      savingsLump,
      generalRow,
      {
        name: "Gold",
        icon: "🪙",
        color: "#F0A83E",
        budget: 2000,
        bracketId: 2,
      },
    ];
    const result = computeCatchAllAdjustment(
      [savingsLump, generalRow],
      draft,
      "Savings",
    );
    expect(result?.catchAllId).toBe(7);
    expect(result?.catchAllName).toBe("General");
  });

  it("matches the bracket name exactly, not as a substring or prefix", () => {
    const notQuite: Category = {
      id: 8,
      name: "Savings Goal",
      icon: "💰",
      color: "#4FD9B8",
      budget: 30000,
      bracketId: 2,
    };
    const draft: Category[] = [
      notQuite,
      {
        name: "Gold",
        icon: "🪙",
        color: "#F0A83E",
        budget: 10000,
        bracketId: 2,
      },
    ];
    expect(computeCatchAllAdjustment([notQuite], draft, "Savings")).toBeNull();
  });
});
