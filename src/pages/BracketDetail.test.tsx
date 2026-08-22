import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import BracketDetail from "./BracketDetail";
import { db } from "../db/db";

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
        <Route
          path="/bracket/:id"
          element={<BracketDetail currency="₹" monthlyIncome={0} />}
        />
        <Route path="/settings" element={<div>Settings screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function makeBracket(
  name: string,
  kind: "spend" | "allocation" | "income" = "allocation",
) {
  return db.brackets.add({ name, icon: "💰", color: "#4FD9B8", kind });
}

describe("BracketDetail — archive/delete a bracket", () => {
  it("archiving an empty bracket sets archived=true and navigates back to Settings, with no confirm prompt needed", async () => {
    const id = await makeBracket("Unused Bracket");
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText("Archive bracket"));

    const bracket = await db.brackets.get(id);
    expect(bracket?.archived).toBe(true);
    expect(await screen.findByText("Settings screen")).toBeInTheDocument();
  });

  it("deleting an empty bracket, confirmed, removes it entirely", async () => {
    const id = await makeBracket("Unused Bracket");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText("Delete bracket"));

    await waitFor(async () =>
      expect(await db.brackets.get(id)).toBeUndefined(),
    );
    expect(await screen.findByText("Settings screen")).toBeInTheDocument();
  });

  it("deleting an empty bracket, cancelled at the confirm, leaves it untouched", async () => {
    const id = await makeBracket("Unused Bracket");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText("Delete bracket"));

    expect(await db.brackets.get(id)).toBeDefined();
  });

  it("a bracket with categories: declining the delete-confirm falls back to archiving (bracket AND its categories survive, just hidden)", async () => {
    const id = await makeBracket("Savings");
    const catId = await db.categories.add({
      name: "Emergency Fund",
      icon: "💰",
      color: "#4FD9B8",
      budget: 5000,
      bracketId: id,
    });
    vi.spyOn(window, "confirm").mockReturnValue(false); // "Cancel" on the delete-or-archive prompt
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText("Delete bracket"));

    const bracket = await db.brackets.get(id);
    expect(bracket?.archived).toBe(true);
    // Archiving never touches the categories themselves.
    expect(await db.categories.get(catId)).toBeDefined();
  });

  it("a bracket with categories and transactions: confirming the delete cascades to its categories, leaving their transactions pointing at a now-deleted category (shown as Uncategorized elsewhere in the app)", async () => {
    const id = await makeBracket("Savings");
    const catId = await db.categories.add({
      name: "Emergency Fund",
      icon: "💰",
      color: "#4FD9B8",
      budget: 5000,
      bracketId: id,
    });
    await db.transactions.add({
      type: "expense",
      amount: 1000,
      categoryId: catId,
      date: "2026-08-05",
      createdAt: Date.now(),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true); // "OK, delete everything"
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText("Delete bracket"));

    await waitFor(async () =>
      expect(await db.brackets.get(id)).toBeUndefined(),
    );
    expect(await db.categories.get(catId)).toBeUndefined();
    // The transaction itself is never deleted — only its category link goes stale.
    const tx = await db.transactions.toArray();
    expect(tx).toHaveLength(1);
    expect(tx[0].categoryId).toBe(catId);
  });
});

describe("BracketDetail — draftCats stays in sync with the DB, not just the id set", () => {
  it('the "New budget total" preview updates immediately after Save — not just after leaving and returning to the page', async () => {
    // Regression guard: draftCats used to only re-sync when the SET of
    // category ids changed (add/remove), so a save that only changed an
    // EXISTING category's budget (General shrinking, exactly what happens
    // here) left the form and this banner showing stale numbers until
    // something else forced a full remount.
    const id = await makeBracket("Expenditure", "spend");
    await db.categories.add({
      name: "General",
      icon: "💳",
      color: "#7C93F0",
      budget: 23000,
      bracketId: id,
    });
    await db.categories.add({
      name: "Food",
      icon: "🍔",
      color: "#F0B94D",
      budget: 0,
      bracketId: id,
    });
    const user = userEvent.setup();
    renderBracket(id);

    const budgetInputs = await screen.findAllByPlaceholderText("Budget");
    const foodBudgetInput = budgetInputs[budgetInputs.length - 1];
    await user.clear(foodBudgetInput);
    await user.type(foodBudgetInput, "9000");
    await user.click(screen.getByText("Save changes"));

    // No unmount/remount here — same component instance, same as staying
    // on the page. The top tile ("Budgeted") should read 23000 (unchanged
    // total) and the preview banner should no longer show the old "+9000"
    // mismatch, purely from the live query + effect re-syncing on their own.
    await waitFor(() => {
      const budgetedValue = screen
        .getByText("Budgeted")
        .closest("div")
        ?.parentElement?.querySelector(".value");
      expect(budgetedValue?.textContent).toBe("₹23,000");
    });
    // The live query updating (above) and draftCats re-syncing to match it
    // are two separate render passes (the effect fires a render after the
    // one where activeCategories first reflects the new totals) — wait for
    // this one too rather than asserting it's already settled.
    await waitFor(() => {
      expect(
        screen.queryByText(/vs current ₹23,000\)/),
      ).not.toBeInTheDocument();
    });
  });
});

describe("BracketDetail — General auto-shrinks when a real category is added", () => {
  it('filling in an EXISTING ₹0 starter category (e.g. onboarding\'s pre-seeded "Food") shrinks General too, not just a brand-new row', async () => {
    // This is the exact real-world case that was broken: Expenditure's
    // onboarding fallback seeds Rent/Food/etc. at ₹0 alongside General.
    // Typing a budget into one of them isn't "adding a category" via the
    // + button — it's editing an existing row — but it must still draw
    // from General the same way a brand-new category would.
    const id = await makeBracket("Expenditure", "spend");
    await db.categories.add({
      name: "General",
      icon: "💳",
      color: "#7C93F0",
      budget: 23000,
      bracketId: id,
    });
    await db.categories.add({
      name: "Food",
      icon: "🍔",
      color: "#F0B94D",
      budget: 0,
      bracketId: id,
    });
    const user = userEvent.setup();
    renderBracket(id);

    const budgetInputs = await screen.findAllByPlaceholderText("Budget");
    const foodBudgetInput = budgetInputs[budgetInputs.length - 1]; // Food, added second
    await user.clear(foodBudgetInput);
    await user.type(foodBudgetInput, "9000");

    await user.click(screen.getByText("Save changes"));

    await waitFor(async () => {
      const cats = await db.categories.where("bracketId").equals(id).toArray();
      const food = cats.find((c) => c.name === "Food");
      const gen = cats.find((c) => c.name === "General");
      expect(food?.budget).toBe(9000);
      expect(gen?.budget).toBe(14000);
      expect(gen?.archived).toBeFalsy();
      // Total unchanged at 23000 — not 32000.
      expect(
        cats.filter((c) => !c.archived).reduce((s, c) => s + c.budget, 0),
      ).toBe(23000);
    });
  });

  it('adding "Rent" shrinks General by the same amount, keeping the bracket total unchanged', async () => {
    const id = await makeBracket("Expenditure", "spend");
    await db.categories.add({
      name: "General",
      icon: "💳",
      color: "#7C93F0",
      budget: 23000,
      bracketId: id,
    });
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText("+ Add category"));
    const nameInputs = await screen.findAllByPlaceholderText("Category");
    const budgetInputs = screen.getAllByPlaceholderText("Budget");
    await user.type(nameInputs[nameInputs.length - 1], "Rent");
    await user.type(budgetInputs[budgetInputs.length - 1], "5000");

    await user.click(screen.getByText("Save changes"));

    await waitFor(async () => {
      const cats = await db.categories.where("bracketId").equals(id).toArray();
      const rent = cats.find((c) => c.name === "Rent");
      const gen = cats.find((c) => c.name === "General");
      expect(rent?.budget).toBe(5000);
      expect(gen?.budget).toBe(18000);
      expect(gen?.archived).toBeFalsy();
    });
  });

  it("draining General to exactly 0 archives it, so it drops out of the active category list", async () => {
    const id = await makeBracket("Expenditure", "spend");
    await db.categories.add({
      name: "General",
      icon: "💳",
      color: "#7C93F0",
      budget: 5000,
      bracketId: id,
    });
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText("+ Add category"));
    const nameInputs = await screen.findAllByPlaceholderText("Category");
    const budgetInputs = screen.getAllByPlaceholderText("Budget");
    await user.type(nameInputs[nameInputs.length - 1], "Rent");
    await user.type(budgetInputs[budgetInputs.length - 1], "5000");

    await user.click(screen.getByText("Save changes"));

    await waitFor(async () => {
      const gen = await db.categories
        .where({ bracketId: id, name: "General" })
        .first();
      expect(gen?.budget).toBe(0);
      expect(gen?.archived).toBe(true);
    });
    // Archived General should no longer show up in the editor at all.
    expect(screen.queryByDisplayValue("General")).not.toBeInTheDocument();
  });

  it("adding more than General has left raises the total for the shortfall, rather than silently capping the new category", async () => {
    const id = await makeBracket("Expenditure", "spend");
    await db.categories.add({
      name: "General",
      icon: "💳",
      color: "#7C93F0",
      budget: 3000,
      bracketId: id,
    });
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText("+ Add category"));
    const nameInputs = await screen.findAllByPlaceholderText("Category");
    const budgetInputs = screen.getAllByPlaceholderText("Budget");
    await user.type(nameInputs[nameInputs.length - 1], "Rent");
    await user.type(budgetInputs[budgetInputs.length - 1], "5000");

    await user.click(screen.getByText("Save changes"));

    await waitFor(async () => {
      const cats = await db.categories.where("bracketId").equals(id).toArray();
      const rent = cats.find((c) => c.name === "Rent");
      const gen = cats.find((c) => c.name === "General");
      expect(rent?.budget).toBe(5000);
      expect(gen?.budget).toBe(0);
      expect(gen?.archived).toBe(true);
      // Total is now 5000 (Rent only, General drained) — genuinely grew
      // from the original 3000, since General couldn't cover all of it.
      expect(
        cats.filter((c) => !c.archived).reduce((s, c) => s + c.budget, 0),
      ).toBe(5000);
    });
  });
});

describe("BracketDetail — the same auto-shrink applies to Savings/Investments' bracket-named lump category", () => {
  it('adding "Gold" under Investments shrinks the lone "Investments" lump category, not just a category literally named "General"', async () => {
    // Savings/Investments' onboarding fallback (no starter categories to
    // seed alongside it) names the lump category after the bracket itself
    // rather than "General" — must draw from the same unassigned-pool
    // logic, not just the literal word "General".
    const id = await makeBracket("Investments", "allocation");
    await db.categories.add({
      name: "Investments",
      icon: "📈",
      color: "#B98CF0",
      budget: 30000,
      bracketId: id,
    });
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText("+ Add category"));
    const nameInputs = await screen.findAllByPlaceholderText("Category");
    const budgetInputs = screen.getAllByPlaceholderText("Target");
    await user.type(nameInputs[nameInputs.length - 1], "Gold");
    await user.type(budgetInputs[budgetInputs.length - 1], "10000");

    await user.click(screen.getByText("Save changes"));

    await waitFor(async () => {
      const cats = await db.categories.where("bracketId").equals(id).toArray();
      const gold = cats.find((c) => c.name === "Gold");
      const lump = cats.find((c) => c.name === "Investments");
      expect(gold?.budget).toBe(10000);
      expect(lump?.budget).toBe(20000);
      expect(lump?.archived).toBeFalsy();
      expect(
        cats.filter((c) => !c.archived).reduce((s, c) => s + c.budget, 0),
      ).toBe(30000);
    });
  });
});
