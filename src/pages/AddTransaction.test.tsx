import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AddTransaction from "./AddTransaction";
import { db } from "../db/db";
import Toast from "../components/Toast";

beforeEach(async () => {
  await db.transactions.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
  await db.splitShares.clear();
});

function renderAdd() {
  return render(
    <MemoryRouter initialEntries={["/add"]}>
      <AddTransaction />
    </MemoryRouter>,
  );
}

// Toast renders at the App shell level in the real app, not inside
// AddTransaction itself — the one test that needs to see toast text (not
// just infer it from a resulting DB change) needs it mounted alongside.
function renderAddWithToast() {
  return render(
    <MemoryRouter initialEntries={["/add"]}>
      <AddTransaction />
      <Toast />
    </MemoryRouter>,
  );
}

describe("AddTransaction — empty-state copy matches the active tab", () => {
  it('says "No categories set up yet" on the Expense tab (the default tab) when there are no spend/allocation categories', async () => {
    // Regression guard: this used to hard-code "No income sources set up
    // yet" regardless of which tab was open — misleading on the Expense
    // tab, which has nothing to do with income sources.
    renderAdd();
    expect(
      await screen.findByText("No categories set up yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No income sources set up yet."),
    ).not.toBeInTheDocument();
  });

  it('says "No income sources set up yet" on the Income tab when there are no income categories', async () => {
    // An Expenditure category exists, but nothing under Income — switching
    // to the Income tab should show the income-specific empty state, not
    // silently reuse whatever the Expense tab happened to show.
    const bracketId = await db.brackets.add({
      name: "Expenditure",
      icon: "💳",
      color: "#7C93F0",
      kind: "spend",
    });
    await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId,
    });

    const user = userEvent.setup();
    renderAdd();

    await user.click(screen.getByRole("button", { name: "Income" }));

    expect(
      await screen.findByText("No income sources set up yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No categories set up yet."),
    ).not.toBeInTheDocument();
  });

  it("shows the category picker instead of an empty state once a category exists for the active tab", async () => {
    const bracketId = await db.brackets.add({
      name: "Expenditure",
      icon: "💳",
      color: "#7C93F0",
      kind: "spend",
    });
    await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId,
    });

    renderAdd();

    expect(await screen.findByText("Category")).toBeInTheDocument();
    expect(
      screen.queryByText("No categories set up yet."),
    ).not.toBeInTheDocument();
  });
});

describe("AddTransaction — split expense: only your own share is ever saved as the transaction", () => {
  async function seedFoodCategory() {
    const bracketId = await db.brackets.add({
      name: "Expenditure",
      icon: "💳",
      color: "#7C93F0",
      kind: "spend",
    });
    return db.categories.add({
      name: "Food",
      icon: "🍔",
      color: "#F0B94D",
      budget: 10000,
      bracketId,
    });
  }

  it("splitting a ₹3,000 dinner 3 ways saves ₹1,000 as the transaction and creates two ₹1,000 IOU rows", async () => {
    await seedFoodCategory();
    const user = userEvent.setup();
    renderAdd();

    await user.type(await screen.findByPlaceholderText("0.00"), "3000");
    await user.click(
      await screen.findByRole("button", { name: /Split this expense/i }),
    );

    // First person row already exists from toggling split on; add a second.
    await user.click(screen.getByText("+ Add person"));

    const nameInputs = screen.getAllByPlaceholderText("Name");
    await user.type(nameInputs[0], "Rahul");
    await user.type(nameInputs[1], "Priya");
    // Auto-even-divide already filled ₹1,000 each for a 3-way split —
    // confirm that landed correctly rather than retyping it.
    expect(await screen.findByText(/Your share/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      const txs = await db.transactions.toArray();
      expect(txs).toHaveLength(1);
      expect(txs[0].amount).toBe(1000); // your share only — not the 3000 total
    });
    const shares = await db.splitShares.toArray();
    expect(shares).toHaveLength(2);
    expect(shares.map((s) => s.amountOwed).sort()).toEqual([1000, 1000]);
    expect(shares.every((s) => s.amountSettled === 0)).toBe(true);
    expect(new Set(shares.map((s) => s.personName))).toEqual(
      new Set(["Rahul", "Priya"]),
    );
  });

  it("a row with no name or no amount is ignored — not saved as a phantom IOU, and not counted against your share", async () => {
    await seedFoodCategory();
    const user = userEvent.setup();
    renderAdd();

    await user.type(await screen.findByPlaceholderText("0.00"), "1000");
    await user.click(
      await screen.findByRole("button", { name: /Split this expense/i }),
    );
    // Leave the single auto-created person row blank entirely.
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      const txs = await db.transactions.toArray();
      expect(txs).toHaveLength(1);
      expect(txs[0].amount).toBe(1000); // full amount, as if never split
    });
    expect(await db.splitShares.count()).toBe(0);
  });

  it("blocks saving when the split amounts exceed the total, rather than silently saving a negative share", async () => {
    await seedFoodCategory();
    const user = userEvent.setup();
    renderAddWithToast();

    await user.type(await screen.findByPlaceholderText("0.00"), "1000");
    await user.click(
      await screen.findByRole("button", { name: /Split this expense/i }),
    );
    const nameInput = screen.getByPlaceholderText("Name");
    const amountInput = screen.getByPlaceholderText("Amount");
    await user.type(nameInput, "Rahul");
    await user.clear(amountInput);
    await user.type(amountInput, "1500"); // more than the 1000 total

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await db.transactions.count()).toBe(0);
    expect(
      await screen.findByText(/add up to more than the total/i),
    ).toBeInTheDocument();
  });

  it("editing a split preserves a friend's already-recorded partial repayment instead of resetting it to zero", async () => {
    const catId = await seedFoodCategory();
    // Simulate an already-existing split expense with one partial repayment.
    const txId = await db.transactions.add({
      type: "expense",
      amount: 1000,
      categoryId: catId,
      date: "2026-08-01",
      createdAt: Date.now(),
    });
    await db.splitShares.add({
      transactionId: txId,
      personName: "Rahul",
      amountOwed: 1000,
      amountSettled: 400,
      createdAt: Date.now(),
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/add?edit=${txId}`]}>
        <AddTransaction />
      </MemoryRouter>,
    );

    // Correct Rahul's share upward from 1000 to 1200 (total becomes 2200).
    const rahulAmount = await screen.findByDisplayValue("1000");
    await user.clear(rahulAmount);
    await user.type(rahulAmount, "1200");
    await user.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );

    await waitFor(async () => {
      const shares = await db.splitShares.toArray();
      expect(shares).toHaveLength(1);
      expect(shares[0].amountOwed).toBe(1200);
      // The 400 Rahul already paid back is untouched by the edit.
      expect(shares[0].amountSettled).toBe(400);
    });
  });

  it("removing a person from an edited split deletes their IOU row entirely", async () => {
    const catId = await seedFoodCategory();
    const txId = await db.transactions.add({
      type: "expense",
      amount: 1000,
      categoryId: catId,
      date: "2026-08-01",
      createdAt: Date.now(),
    });
    await db.splitShares.add({
      transactionId: txId,
      personName: "Rahul",
      amountOwed: 1000,
      amountSettled: 0,
      createdAt: Date.now(),
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/add?edit=${txId}`]}>
        <AddTransaction />
      </MemoryRouter>,
    );

    await screen.findByDisplayValue("Rahul");
    await user.click(screen.getByRole("button", { name: "Remove person" }));
    await user.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );

    await waitFor(async () => {
      expect(await db.splitShares.count()).toBe(0);
    });
  });
});

describe("AddTransaction — save failures", () => {
  async function seedFoodCategory() {
    const bracketId = await db.brackets.add({
      name: "Expenditure",
      icon: "💳",
      color: "#7C93F0",
      kind: "spend",
    });
    return db.categories.add({
      name: "Food",
      icon: "🍔",
      color: "#F0B94D",
      budget: 10000,
      bracketId,
    });
  }

  it("tells the person it was NOT saved and re-enables Save when the database write fails", async () => {
    await seedFoodCategory();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const addSpy = vi
      .spyOn(db.transactions, "add")
      .mockRejectedValueOnce(new Error("QuotaExceededError"));
    const user = userEvent.setup();
    renderAddWithToast();

    await user.type(await screen.findByPlaceholderText("0.00"), "250");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Couldn't save that. Please try again."),
    ).toBeInTheDocument();
    expect(await db.transactions.count()).toBe(0);
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();

    addSpy.mockRestore();
  });
});
