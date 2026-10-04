import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({}),
}));
vi.mock("./widgetBridge", () => ({
  syncWidget: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "../db/db";
import { syncWidget } from "./widgetBridge";
import { buildWidgetSnapshot, clearWidget, startWidgetSync } from "./widgetSync";
import { todayISO } from "./format";

const sync = vi.mocked(syncWidget);

beforeEach(async () => {
  sync.mockClear();
  await Promise.all([
    db.transactions.clear(),
    db.categories.clear(),
    db.brackets.clear(),
    db.settings.clear(),
    db.budgetHistory.clear(),
    db.recurring.clear(),
    db.splitShares.clear(),
  ]);
});

async function seed() {
  const spendId = await db.brackets.add({
    name: "Expenditure",
    icon: "💳",
    color: "#7C93F0",
    kind: "spend",
  });
  const saveId = await db.brackets.add({
    name: "Savings",
    icon: "💰",
    color: "#4FD9B8",
    kind: "allocation",
  });
  const food = await db.categories.add({
    name: "Food",
    icon: "🍲",
    color: "#6FC98A",
    budget: 1000,
    bracketId: spendId,
  });
  const fund = await db.categories.add({
    name: "Emergency fund",
    icon: "🛟",
    color: "#4FD9B8",
    budget: 0,
    bracketId: saveId,
  });
  return { food, fund };
}

describe("buildWidgetSnapshot", () => {
  it("is all zeros, masked, with no category names when the database is empty", async () => {
    const snap = await buildWidgetSnapshot();
    expect(snap).toMatchObject({
      spent: 0,
      budget: 0,
      remaining: 0,
      hideAmounts: true,
      categories: [],
    });
  });

  it("totals this month's capped spend and lists top categories, ignoring allocation transfers", async () => {
    const { food, fund } = await seed();
    const today = todayISO();
    await db.transactions.bulkAdd([
      { type: "expense", amount: 300, categoryId: food, date: today, createdAt: 1 },
      { type: "expense", amount: 200, categoryId: food, date: today, createdAt: 2 },
      { type: "expense", amount: 5000, categoryId: fund, date: today, createdAt: 3 },
    ]);
    const snap = await buildWidgetSnapshot();
    expect(snap.spent).toBe(500);
    expect(snap.categories).toEqual([
      expect.objectContaining({ name: "Food", spent: 500, budget: 1000 }),
    ]);
  });

  it("mirrors the hideWidgetAmounts setting and currency", async () => {
    await db.settings.put({
      id: 1,
      onboarded: true,
      currency: "$",
      theme: "dark",
      monthlyIncome: 0,
      carryForward: false,
      hideWidgetAmounts: false,
    });
    expect(await buildWidgetSnapshot()).toMatchObject({
      currency: "$",
      hideAmounts: false,
    });
  });
});

describe("clearWidget", () => {
  it("pushes a blank snapshot with no totals and no category names", async () => {
    await clearWidget();
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        spent: 0,
        budget: 0,
        remaining: 0,
        monthLabel: "",
        categories: [],
      }),
    );
  });
});

describe("startWidgetSync", () => {
  it("re-pushes the widget after a write made anywhere in the app", async () => {
    const { food } = await seed();
    const stop = startWidgetSync();
    try {
      await vi.waitFor(() => expect(sync).toHaveBeenCalled());
      sync.mockClear();

      await db.transactions.add({
        type: "expense",
        amount: 250,
        categoryId: food,
        date: todayISO(),
        createdAt: 1,
      });

      await vi.waitFor(() =>
        expect(sync).toHaveBeenCalledWith(expect.objectContaining({ spent: 250 })),
      );
    } finally {
      stop();
    }
  });

  it("pushes the emptied state after the data is cleared (e.g. erase / restore)", async () => {
    const { food } = await seed();
    await db.transactions.add({
      type: "expense",
      amount: 400,
      categoryId: food,
      date: todayISO(),
      createdAt: 1,
    });
    const stop = startWidgetSync();
    try {
      await vi.waitFor(() =>
        expect(sync).toHaveBeenCalledWith(expect.objectContaining({ spent: 400 })),
      );
      sync.mockClear();
      await db.transactions.clear();
      await db.categories.clear();
      await vi.waitFor(() =>
        expect(sync).toHaveBeenCalledWith(
          expect.objectContaining({ spent: 0, categories: [] }),
        ),
      );
    } finally {
      stop();
    }
  });
});
