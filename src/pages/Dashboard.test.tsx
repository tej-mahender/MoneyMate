import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";
import { db, computeMonthSummary } from "../db/db";
import { fmtMoney, monthKey, todayISO, addMonths, monthLabel } from "../lib/format";

// Each test gets a clean database — fake-indexeddb persists across tests
// within a run otherwise, which would let state leak between cases.
beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
  await db.budgetHistory.clear();
  localStorage.clear();
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard currency="₹" />
    </MemoryRouter>,
  );
}

async function makeBracket(
  kind: "spend" | "allocation" | "income",
  name = "Expenditure",
) {
  return db.brackets.add({ name, icon: "💳", color: "#7C93F0", kind });
}

describe("Dashboard — budget cap scoping", () => {
  it("excludes allocation-category transactions (Savings) from Spent/Remaining, counting only spend-category transactions", async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket("spend", "Expenditure");
    const savingsBracketId = await makeBracket("allocation", "Savings");
    const rentId = await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId: expenditureId,
    });
    const savingsId = await db.categories.add({
      name: "Savings",
      icon: "💰",
      color: "#4FD9B8",
      budget: 5000,
      bracketId: savingsBracketId,
    });

    await db.transactions.add({
      type: "expense",
      amount: 8000,
      categoryId: rentId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });
    // A transfer into Savings — real money moved, but not spend against the cap.
    await db.transactions.add({
      type: "expense",
      amount: 5000,
      categoryId: savingsId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    renderDashboard();

    // "Spent" must reflect only the Rent transaction (8000), not 8000+5000.
    // (The figure also appears in the "Budget health" copy below the ring,
    // hence AllBy rather than By.)
    expect(
      (await screen.findAllByText(fmtMoney(8000, "₹"))).length,
    ).toBeGreaterThan(0);
    // "Remaining" = budget cap (20000, Savings' target excluded) − spent (8000).
    expect(
      (await screen.findAllByText(fmtMoney(12000, "₹"))).length,
    ).toBeGreaterThan(0);

    // Savings never appears in the "By category" budget list — though it
    // legitimately still shows up further down in "Recent transactions"
    // (the transfer really happened, it's just not counted against the cap),
    // so this scopes the check to the By category card specifically.
    const byCategoryHeading = screen.getByText("By category");
    const byCategoryCard = byCategoryHeading.closest(".card") as HTMLElement;
    expect(
      within(byCategoryCard).queryByText("Savings"),
    ).not.toBeInTheDocument();
    expect(within(byCategoryCard).getByText("Rent")).toBeInTheDocument();
  });

  it("still counts a spend-category transaction normally when there are no allocation categories at all", async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket("spend", "Expenditure");
    const foodId = await db.categories.add({
      name: "Food",
      icon: "🍲",
      color: "#6FC98A",
      budget: 10000,
      bracketId: expenditureId,
    });
    await db.transactions.add({
      type: "expense",
      amount: 3000,
      categoryId: foodId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    renderDashboard();

    expect(
      (await screen.findAllByText(fmtMoney(3000, "₹"))).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText(fmtMoney(7000, "₹"))).length,
    ).toBeGreaterThan(0);
  });

  it('aggregates across multiple spend-kind brackets, not just one hardcoded "Expenditure"', async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket("spend", "Expenditure");
    const workId = await makeBracket("spend", "Work Expenses");
    const rentId = await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId: expenditureId,
    });
    const travelId = await db.categories.add({
      name: "Travel",
      icon: "✈️",
      color: "#F0A83E",
      budget: 5000,
      bracketId: workId,
    });
    await db.transactions.add({
      type: "expense",
      amount: 8000,
      categoryId: rentId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });
    await db.transactions.add({
      type: "expense",
      amount: 2000,
      categoryId: travelId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    renderDashboard();

    expect(
      (await screen.findAllByText(fmtMoney(10000, "₹"))).length,
    ).toBeGreaterThan(0); // total spent
    expect(
      (await screen.findAllByText(fmtMoney(25000, "₹"))).length,
    ).toBeGreaterThan(0); // total budget cap
  });

  it("never shows an Income tile or any income-derived figure, since Budget only knows about the spending cap", async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket("spend", "Expenditure");
    const rentId = await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId: expenditureId,
    });
    await db.transactions.add({
      type: "expense",
      amount: 8000,
      categoryId: rentId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    renderDashboard();

    expect(await screen.findByText("Budgeted")).toBeInTheDocument();
    expect(screen.queryByText("Income")).not.toBeInTheDocument();
  });

  it("excludes an archived category's budget from the total cap, matching Home and BracketDetail", async () => {
    const thisMonthDate = `${monthKey(todayISO())}-15`;
    const expenditureId = await makeBracket("spend", "Expenditure");
    const rentId = await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId: expenditureId,
    });
    const oldGymId = await db.categories.add({
      name: "Gym (old)",
      icon: "🏋️",
      color: "#F0B94D",
      budget: 3000,
      bracketId: expenditureId,
      archived: true,
    });

    await db.transactions.add({
      type: "expense",
      amount: 8000,
      categoryId: rentId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });
    // Historical spend against the now-archived category should still
    // count as spend this month — archiving stops future budgeting, it
    // doesn't erase what already happened.
    await db.transactions.add({
      type: "expense",
      amount: 1000,
      categoryId: oldGymId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    renderDashboard();

    // Budget cap: only Rent's 20000 — the archived Gym category's 3000
    // budget must not still be counted (previously it was, unlike Home
    // and BracketDetail which already excluded archived categories).
    // Spent: 8000 + 1000 = 9000. Remaining: 20000 − 9000 = 11000.
    expect(
      (await screen.findAllByText(fmtMoney(9000, "₹"))).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText(fmtMoney(11000, "₹"))).length,
    ).toBeGreaterThan(0);

    const byCategoryHeading = screen.getByText("By category");
    const byCategoryCard = byCategoryHeading.closest(".card") as HTMLElement;
    expect(
      within(byCategoryCard).queryByText("Gym (old)"),
    ).not.toBeInTheDocument();
  });
});

describe("Dashboard — top-line figures are computeMonthSummary(), not a second copy of the same math", () => {
  it("renders exactly what computeMonthSummary() returns for the same data, so the two can't silently drift apart", async () => {
    const expenditureId = await makeBracket("spend", "Expenditure");
    const savingsId = await makeBracket("allocation", "Savings");
    const rentId = await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 15000,
      bracketId: expenditureId,
    });
    const savingsCatId = await db.categories.add({
      name: "Savings",
      icon: "💰",
      color: "#4FD9B8",
      budget: 5000,
      bracketId: savingsId,
    });
    const thisMonthDate = `${monthKey(todayISO())}-10`;
    await db.transactions.add({
      type: "expense",
      amount: 6000,
      categoryId: rentId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });
    // Money moved into Savings — must not count as "Spent" on Budget.
    await db.transactions.add({
      type: "expense",
      amount: 5000,
      categoryId: savingsCatId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    const summary = await computeMonthSummary();

    renderDashboard();

    expect(
      (await screen.findAllByText(fmtMoney(summary.budget, "₹"))).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText(fmtMoney(summary.spent, "₹"))).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText(fmtMoney(summary.remaining, "₹"))).length,
    ).toBeGreaterThan(0);
    // Pin the actual values too, so this test still means something if
    // computeMonthSummary itself ever regresses rather than just Dashboard
    // silently matching whatever it (possibly wrongly) returns.
    expect(summary).toMatchObject({
      budget: 15000,
      spent: 6000,
      remaining: 9000,
    });
  });
});

describe("Dashboard — closed-month review", () => {
  async function seedPastMonth() {
    const cur = monthKey(todayISO());
    const past = addMonths(cur, -2);
    const bracketId = await makeBracket("spend");
    // Food's cap is 6000 today but was 4000 back then.
    const food = await db.categories.add({ name: "Food", icon: "🍲", color: "#6FC98A", budget: 6000, bracketId });
    const rent = await db.categories.add({ name: "Rent", icon: "🏠", color: "#F0B94D", budget: 14000, bracketId });
    const early = addMonths(cur, -4);
    await db.budgetHistory.bulkAdd([
      { categoryId: food, month: early, budget: 4000, origin: "migrated", createdAt: 0 },
      { categoryId: food, month: addMonths(cur, -1), budget: 6000, origin: "edited", createdAt: 0 },
      { categoryId: rent, month: early, budget: 14000, origin: "migrated", createdAt: 0 },
    ]);
    await db.transactions.add({ type: "expense", amount: 4500, categoryId: food, date: `${past}-10`, createdAt: 0 });
    await db.transactions.add({ type: "expense", amount: 14000, categoryId: rent, date: `${past}-01`, createdAt: 0 });
    return { cur, past };
  }

  it("steps back to a closed month and reports it against the cap that applied then", async () => {
    const { past } = await seedPastMonth();
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByLabelText("Previous month");
    await user.click(screen.getByLabelText("Previous month"));
    await user.click(screen.getByLabelText("Previous month"));

    expect((await screen.findAllByText(monthLabel(past))).length).toBeGreaterThan(0);
    // Budgeted 4000 + 14000 = 18000 (not today's 20000); spent 18500.
    expect(await screen.findByText(`Over budget by ${fmtMoney(500, "₹")}`)).toBeInTheDocument();
    expect(screen.getByText(fmtMoney(18000, "₹"))).toBeInTheDocument();
    expect(screen.getByText(`1 category went over its cap`)).toBeInTheDocument();
    const card = screen.getByText("By category").closest(".card") as HTMLElement;
    expect(within(card).getByText(/over by/)).toBeInTheDocument();
  });

  it("can't step past the current month, and 'This month' returns to the live view", async () => {
    await seedPastMonth();
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByLabelText("Previous month");
    expect(screen.getByLabelText("Next month")).toBeDisabled();

    await user.click(screen.getByLabelText("Previous month"));
    expect(screen.getByLabelText("Next month")).toBeEnabled();
    await user.click(await screen.findByText("This month"));
    await waitFor(() => expect(screen.getByLabelText("Next month")).toBeDisabled());
    expect(screen.getByText("Budget health")).toBeInTheDocument();
  });

  it("stops the back arrow at the earliest month with data", async () => {
    await seedPastMonth(); // earliest data is 4 months back
    const user = userEvent.setup();
    renderDashboard();
    const back = await screen.findByLabelText("Previous month");
    await waitFor(() => expect(back).toBeEnabled());
    for (let i = 0; i < 4; i++) await user.click(screen.getByLabelText("Previous month"));
    await waitFor(() => expect(screen.getByLabelText("Previous month")).toBeDisabled());
  });

  it("opens straight on ?month= when deep-linked", async () => {
    const { past } = await seedPastMonth();
    render(
      <MemoryRouter initialEntries={[`/budget?month=${past}`]}>
        <Dashboard currency="₹" />
      </MemoryRouter>,
    );
    expect(await screen.findByText(`Over budget by ${fmtMoney(500, "₹")}`)).toBeInTheDocument();
  });

  it("says so when a closed month has nothing recorded", async () => {
    const user = userEvent.setup();
    await makeBracket("spend");
    await db.transactions.add({ type: "expense", amount: 10, categoryId: 999, date: `${addMonths(monthKey(todayISO()), -3)}-05`, createdAt: 0 });
    renderDashboard();
    await screen.findByLabelText("Previous month");
    await waitFor(() => expect(screen.getByLabelText("Previous month")).toBeEnabled());
    await user.click(screen.getByLabelText("Previous month"));
    expect(await screen.findByText(/Nothing recorded for/)).toBeInTheDocument();
  });
});

describe("Dashboard — month-end review prompt", () => {
  afterEach(() => vi.useRealTimers());

  async function seedSeptember() {
    const bracketId = await makeBracket("spend");
    const food = await db.categories.add({ name: "Food", icon: "🍲", color: "#6FC98A", budget: 4000, bracketId });
    await db.transactions.add({ type: "expense", amount: 4500, categoryId: food, date: "2026-09-10", createdAt: 0 });
  }
  const at = (y: number, m: number, d: number) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(y, m - 1, d, 12));
  };

  it("offers last month's review in the first week, and 'Review' opens it and retires the prompt", async () => {
    at(2026, 10, 3);
    await seedSeptember();
    const user = userEvent.setup();
    renderDashboard();

    expect(await screen.findByText("September 2026 is wrapped up")).toBeInTheDocument();
    await user.click(screen.getByText("Review"));
    expect(await screen.findByText(`Over budget by ${fmtMoney(500, "₹")}`)).toBeInTheDocument();

    await user.click(screen.getByText("This month"));
    await screen.findByText("Budget health");
    expect(screen.queryByText("September 2026 is wrapped up")).not.toBeInTheDocument();
  });

  it("stays dismissed once dismissed", async () => {
    at(2026, 10, 3);
    await seedSeptember();
    const user = userEvent.setup();
    const { unmount } = renderDashboard();
    await user.click(await screen.findByLabelText("Dismiss"));
    expect(screen.queryByText("September 2026 is wrapped up")).not.toBeInTheDocument();
    unmount();

    renderDashboard();
    await screen.findByText("Budget health");
    expect(screen.queryByText("September 2026 is wrapped up")).not.toBeInTheDocument();
  });

  it("doesn't appear after the first week, or when last month has no transactions", async () => {
    at(2026, 10, 15);
    await seedSeptember();
    const { unmount } = renderDashboard();
    await screen.findByText("Budget health");
    expect(screen.queryByText(/is wrapped up/)).not.toBeInTheDocument();
    unmount();

    vi.setSystemTime(new Date(2026, 10, 2, 12)); // 2 Nov — October is empty
    renderDashboard();
    await screen.findByText("Budget health");
    expect(screen.queryByText(/is wrapped up/)).not.toBeInTheDocument();
  });
});

describe("Dashboard — backup reminder", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function seedTransactions(n: number, enteredAt = Date.now() - 40 * DAY) {
    const bracketId = await makeBracket("spend");
    const catId = await db.categories.add({
      name: "Food",
      icon: "🍔",
      color: "#F0B94D",
      budget: 5000,
      bracketId,
    });
    await db.transactions.bulkAdd(
      Array.from({ length: n }, (_, i) => ({
        type: "expense" as const,
        amount: 10,
        categoryId: catId,
        date: todayISO(),
        createdAt: enteredAt + i,
      })),
    );
  }

  it("stays out of the way until there is real data to lose", async () => {
    await seedTransactions(2);
    renderDashboard();
    await screen.findByText("Budgeted");
    expect(screen.queryByText("Back up your data")).not.toBeInTheDocument();
  });

  it("does not nag a new user who has never backed up while their data is recent", async () => {
    await seedTransactions(6, Date.now() - 3 * DAY);
    renderDashboard();
    await screen.findByText("Budgeted");
    expect(screen.queryByText("Back up your data")).not.toBeInTheDocument();
  });

  it("reminds a user who has never backed up once their data is over a month old", async () => {
    await seedTransactions(6, Date.now() - 40 * DAY);
    renderDashboard();
    expect(await screen.findByText("Back up your data")).toBeInTheDocument();
  });

  it("is hidden after a recent backup", async () => {
    await seedTransactions(6);
    await db.settings.put({
      id: 1, onboarded: true, currency: "₹", theme: "dark",
      monthlyIncome: 0, carryForward: false, lastBackupAt: Date.now() - 2 * 86400000,
    });
    renderDashboard();
    await screen.findByText("Budgeted");
    expect(screen.queryByText("Back up your data")).not.toBeInTheDocument();
  });

  it('"Remind me later" hides it and the snooze is saved', async () => {
    await seedTransactions(6);
    const user = userEvent.setup();
    renderDashboard();
    await user.click(await screen.findByRole("button", { name: "Remind me later" }));

    await waitFor(() =>
      expect(screen.queryByText("Back up your data")).not.toBeInTheDocument(),
    );
    const saved = await db.settings.get(1);
    expect(saved?.backupNudgeSnoozedUntil ?? 0).toBeGreaterThan(Date.now());
  });
});
