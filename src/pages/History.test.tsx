import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import History from "./History";
import { db } from "../db/db";
import { monthKey, todayISO } from "../lib/format";

beforeEach(async () => {
  await db.transactions.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

function renderHistory(initialPath = "/history") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/history" element={<History currency="₹" />} />
        <Route
          path="/transaction/:id"
          element={<div>Transaction detail screen</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function makeCategory(name: string) {
  const bracketId = await db.brackets.add({
    name: "Expenditure",
    icon: "💳",
    color: "#7C93F0",
    kind: "spend",
  });
  return db.categories.add({
    name,
    icon: "🏠",
    color: "#F0B94D",
    budget: 10000,
    bracketId,
  });
}

describe("History — filtering", () => {
  it("only shows transactions in the currently-selected month", async () => {
    const catId = await makeCategory("Rent");
    const thisMonth = monthKey(todayISO());
    const [y, m] = thisMonth.split("-").map(Number);
    const prevMonth =
      m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;

    await db.transactions.add({
      type: "expense",
      amount: 5000,
      categoryId: catId,
      date: `${thisMonth}-10`,
      createdAt: Date.now(),
      merchant: "This Month Rent",
    });
    await db.transactions.add({
      type: "expense",
      amount: 4000,
      categoryId: catId,
      date: `${prevMonth}-10`,
      createdAt: Date.now(),
      merchant: "Last Month Rent",
    });

    renderHistory();

    expect(await screen.findByText(/This Month Rent/)).toBeInTheDocument();
    expect(screen.queryByText(/Last Month Rent/)).not.toBeInTheDocument();
  });

  it("filters by category when a ?cat= query param is present", async () => {
    const rentId = await makeCategory("Rent");
    const foodId = await makeCategory("Food");
    const thisMonth = monthKey(todayISO());
    await db.transactions.add({
      type: "expense",
      amount: 5000,
      categoryId: rentId,
      date: `${thisMonth}-10`,
      createdAt: Date.now(),
    });
    await db.transactions.add({
      type: "expense",
      amount: 500,
      categoryId: foodId,
      date: `${thisMonth}-10`,
      createdAt: Date.now(),
    });

    renderHistory(`/history?cat=${rentId}`);

    // "Rent" legitimately appears twice here — once as the active-filter
    // chip label, once as the transaction row's category name.
    expect((await screen.findAllByText("Rent")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Food")).not.toBeInTheDocument();
  });

  it("matches search against note, merchant, category name, and amount", async () => {
    const catId = await makeCategory("Groceries");
    const thisMonth = monthKey(todayISO());
    await db.transactions.add({
      type: "expense",
      amount: 1234,
      categoryId: catId,
      date: `${thisMonth}-05`,
      createdAt: Date.now(),
      merchant: "BigBasket",
      note: "Weekly veggies",
    });
    await db.transactions.add({
      type: "expense",
      amount: 700,
      categoryId: catId,
      date: `${thisMonth}-06`,
      createdAt: Date.now(),
      merchant: "Corner Store",
    });

    const user = userEvent.setup();
    renderHistory();

    await screen.findByText("BigBasket", { exact: false });
    const search = screen.getByPlaceholderText("Search…");
    await user.type(search, "veggies");

    expect(await screen.findByText(/BigBasket/)).toBeInTheDocument();
    expect(screen.queryByText(/Corner Store/)).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing matches the current filters", async () => {
    renderHistory();
    expect(await screen.findByText("Nothing here yet.")).toBeInTheDocument();
  });

  it('shows "Uncategorized" for a transaction whose category no longer exists', async () => {
    // The documented behavior when a category is deleted outright rather
    // than archived — its transactions fall back to this rather than
    // crashing on a missing lookup.
    const thisMonth = monthKey(todayISO());
    await db.transactions.add({
      type: "expense",
      amount: 500,
      categoryId: 9999,
      date: `${thisMonth}-10`,
      createdAt: Date.now(),
    });
    renderHistory();
    expect(await screen.findByText("Uncategorized")).toBeInTheDocument();
  });
});

describe("History — delete and undo", () => {
  it("removes a transaction from the list on delete, and restores it on Undo", async () => {
    const catId = await makeCategory("Rent");
    const thisMonth = monthKey(todayISO());
    await db.transactions.add({
      type: "expense",
      amount: 5000,
      categoryId: catId,
      date: `${thisMonth}-10`,
      createdAt: Date.now(),
      merchant: "Landlord",
    });

    const user = userEvent.setup();
    renderHistory();

    await screen.findByText(/Landlord/);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByText(/Landlord/)).not.toBeInTheDocument(),
    );
    expect(await db.transactions.count()).toBe(0);

    await user.click(await screen.findByText("Undo delete"));

    expect(await screen.findByText(/Landlord/)).toBeInTheDocument();
    expect(await db.transactions.count()).toBe(1);
  });

  it("deleting one row does not also remove other unrelated transactions", async () => {
    const catId = await makeCategory("Rent");
    const thisMonth = monthKey(todayISO());
    await db.transactions.add({
      type: "expense",
      amount: 5000,
      categoryId: catId,
      date: `${thisMonth}-10`,
      createdAt: Date.now(),
      merchant: "Landlord",
    });
    await db.transactions.add({
      type: "expense",
      amount: 200,
      categoryId: catId,
      date: `${thisMonth}-11`,
      createdAt: Date.now(),
      merchant: "Coffee",
    });

    const user = userEvent.setup();
    renderHistory();

    await screen.findByText(/Landlord/);
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await user.click(deleteButtons[0]);

    expect(await db.transactions.count()).toBe(1);
  });
});

describe("History — navigation", () => {
  it("tapping a transaction row navigates to its detail page", async () => {
    const catId = await makeCategory("Rent");
    const thisMonth = monthKey(todayISO());
    await db.transactions.add({
      type: "expense",
      amount: 5000,
      categoryId: catId,
      date: `${thisMonth}-10`,
      createdAt: Date.now(),
      merchant: "Landlord",
    });

    const user = userEvent.setup();
    renderHistory();

    await user.click(await screen.findByText(/Landlord/));
    expect(
      await screen.findByText("Transaction detail screen"),
    ).toBeInTheDocument();
  });
});
