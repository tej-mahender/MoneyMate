import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AddTransaction from "./AddTransaction";
import { db } from "../db/db";

beforeEach(async () => {
  await db.transactions.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

function renderAdd() {
  return render(
    <MemoryRouter initialEntries={["/add"]}>
      <AddTransaction />
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
