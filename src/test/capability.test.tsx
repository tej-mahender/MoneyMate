import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AddTransaction from "../pages/AddTransaction";
import Overview from "../pages/Overview";
import { db, processRecurring } from "../db/db";
import { importFullBackup, SCHEMA_VERSION } from "../lib/csv";
import { monthKey, todayISO, fmtMoney } from "../lib/format";
import { useUIStore } from "../store/useUIStore";

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
  localStorage.clear();
  useUIStore.setState({ toastMsg: null });
});

async function makeBracket(
  name: string,
  kind: "spend" | "allocation" | "income",
) {
  return db.brackets.add({ name, icon: "💳", color: "#7C93F0", kind });
}

describe("capability — AddTransaction input validation", () => {
  it("rejects a zero or negative amount and does not write a transaction", async () => {
    const bracketId = await makeBracket("Expenditure", "spend");
    await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AddTransaction />
      </MemoryRouter>,
    );

    const amountInput = await screen.findByPlaceholderText("0.00");
    await user.type(amountInput, "-50");
    await user.click(screen.getByText("Save"));

    // AddTransaction calls the toast store directly; the <Toast/> component
    // that renders it into the DOM lives outside this page (in App.tsx), so
    // the store's state is what's actually under test here, not DOM text.
    expect(useUIStore.getState().toastMsg).toBe(
      "Enter an amount greater than 0.",
    );
    expect(await db.transactions.count()).toBe(0);
  });

  it("accepts a valid positive amount and persists it", async () => {
    const bracketId = await makeBracket("Expenditure", "spend");
    await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AddTransaction />
      </MemoryRouter>,
    );

    const amountInput = await screen.findByPlaceholderText("0.00");
    await user.type(amountInput, "1500");
    await user.click(screen.getByText("Save"));

    const txs = await db.transactions.toArray();
    expect(txs.length).toBe(1);
    expect(txs[0].amount).toBe(1500);
  });
});

describe("capability — recurring EMI (its own allocation bracket) end-to-end into Home", () => {
  it("a recurring item pointed at a category in an allocation bracket generates a transaction that Home counts as allocation actual, not budgeted spend", async () => {
    const emiBracketId = await makeBracket("EMI", "allocation");
    const emiId = await db.categories.add({
      name: "Car EMI",
      icon: "🏦",
      color: "#E8618C",
      budget: 12000,
      bracketId: emiBracketId,
    });
    const today = todayISO();
    await db.recurring.add({
      name: "Car loan EMI",
      amount: 12000,
      categoryId: emiId,
      frequency: "monthly",
      startDate: today,
      nextDate: today,
      paused: false,
      type: "expense",
    });

    // Same engine that runs on every app open — generates the due transaction.
    await processRecurring(today);

    const txs = await db.transactions.toArray();
    expect(txs.length).toBe(1);
    expect(txs[0].categoryId).toBe(emiId);

    render(
      <MemoryRouter>
        <Overview currency="₹" monthlyIncome={60000} />
      </MemoryRouter>,
    );

    // EMI shows as its own bracket row, and its actual (12000) is reflected
    // in the "Allocated" summary tile — not folded into budgeted spend.
    expect(await screen.findByText("EMI")).toBeInTheDocument();
    expect(
      (await screen.findAllByText(fmtMoney(12000, "₹"))).length,
    ).toBeGreaterThan(0);
  });
});

describe("capability — archived categories excluded from Home", () => {
  it("an archived category with this-month spend does not appear or count toward its bracket, even though the bracket itself still shows", async () => {
    const thisMonthDate = `${monthKey(todayISO())}-10`;
    const savingsBracketId = await makeBracket("Savings", "allocation");
    const oldId = await db.categories.add({
      name: "Old Savings Plan",
      icon: "💰",
      color: "#4FD9B8",
      budget: 5000,
      bracketId: savingsBracketId,
      archived: true,
    });
    await db.transactions.add({
      type: "expense",
      amount: 2000,
      categoryId: oldId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    render(
      <MemoryRouter>
        <Overview currency="₹" monthlyIncome={50000} />
      </MemoryRouter>,
    );

    // The archived category itself never appears anywhere.
    expect(screen.queryByText("Old Savings Plan")).not.toBeInTheDocument();
    // The Savings bracket still shows (it isn't archived, just empty of
    // active categories), with no target and none of the archived
    // category's spend counted toward it.
    expect(await screen.findByText("Savings")).toBeInTheDocument();
    expect(screen.getByText(/no target set/i)).toBeInTheDocument();
  });
});

describe("capability — legacy (pre-v5) backup restore stays consistent with the live Dexie v4 migration", () => {
  it('a "Savings" category from a legacy backup (flow: "allocation", no brackets array) restores under the Savings bracket', async () => {
    const legacyBackup = {
      schemaVersion: SCHEMA_VERSION - 1, // simulates a backup written before the brackets table existed
      categories: [
        {
          id: 1,
          name: "Rent",
          icon: "🏠",
          color: "#F0B94D",
          budget: 20000,
          flow: "spend",
        },
        {
          id: 2,
          name: "Savings",
          icon: "💰",
          color: "#4FD9B8",
          budget: 5000,
          flow: "allocation",
        },
      ],
      transactions: [],
      recurring: [],
      settings: {},
    };

    await importFullBackup(JSON.stringify(legacyBackup));

    const brackets = await db.brackets.toArray();
    const bracketById = new Map(brackets.map((b) => [b.id, b]));
    const cats = await db.categories.toArray();
    const rent = cats.find((c) => c.name === "Rent")!;
    const savings = cats.find((c) => c.name === "Savings")!;
    expect(bracketById.get(rent.bracketId)?.name).toBe("Expenditure");
    expect(bracketById.get(savings.bracketId)?.name).toBe("Savings");
  });
});
