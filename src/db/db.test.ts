import { describe, it, expect, beforeEach } from "vitest";
import {
  db,
  advanceDate,
  processRecurring,
  getSettings,
  updateSettings,
  ensureDefaultBracketsSeeded,
  ensureIncomeCategoriesSeeded,
  computeMonthSummary,
  type Frequency,
} from "./db";
import { monthKey, todayISO, addMonths } from "../lib/format";

// Each test gets a clean database — fake-indexeddb persists across tests
// within a run otherwise, which would let state leak between cases.
beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

describe("advanceDate", () => {
  it('advances one day for "daily"', () => {
    expect(advanceDate("2026-08-06", "daily")).toBe("2026-08-07");
  });
  it('advances seven days for "weekly"', () => {
    expect(advanceDate("2026-08-06", "weekly")).toBe("2026-08-13");
  });
  it('advances one calendar month for "monthly"', () => {
    expect(advanceDate("2026-08-06", "monthly")).toBe("2026-09-06");
  });
  it('advances one year for "yearly"', () => {
    expect(advanceDate("2026-08-06", "yearly")).toBe("2027-08-06");
  });
  it("rolls a daily increment over a month boundary", () => {
    expect(advanceDate("2026-08-31", "daily")).toBe("2026-09-01");
  });
  it("rolls a monthly increment over a year boundary", () => {
    expect(advanceDate("2026-12-15", "monthly")).toBe("2027-01-15");
  });
  it("clamps a month-end date that does not exist in the target month (Jan 31 + 1 month)", () => {
    // JS Date's native rollover means Jan 31 + 1 month "spills" into March
    // (Feb 31 doesn't exist) — documenting the actual current behavior so a
    // future change to this is a deliberate decision, not an accident.
    expect(advanceDate("2026-01-31", "monthly")).toBe("2026-03-03");
  });

  // --- Security regression: this is the exact bug from the audit ---------
  it("SECURITY: throws on an unrecognized frequency instead of silently returning the input unchanged", () => {
    // Before the fix, an invalid frequency fell through every branch with
    // no `else`, and the date was returned byte-for-byte unchanged. That
    // meant processRecurring()'s `while (cursor <= todayISO)` loop below
    // never advanced its cursor and span forever — an infinite loop
    // triggered on every single app launch, reachable via nothing more
    // than importing a backup file with a corrupted `frequency` value.
    expect(() => advanceDate("2026-08-06", "hourly" as Frequency)).toThrow(
      /unrecognized frequency/i,
    );
  });
  it("SECURITY: throws (does not silently no-op) for an empty-string frequency", () => {
    expect(() => advanceDate("2026-08-06", "" as Frequency)).toThrow();
  });
});

async function makeExpenditureBracket() {
  return db.brackets.add({
    name: "Expenditure",
    icon: "💳",
    color: "#7C93F0",
    kind: "spend",
  });
}
async function makeCategory(bracketId?: number) {
  const bid = bracketId ?? (await makeExpenditureBracket());
  return db.categories.add({
    name: "Rent",
    icon: "🏠",
    color: "#F0B94D",
    budget: 0,
    bracketId: bid,
  });
}

describe("processRecurring", () => {
  // No fake timers here: processRecurring() takes "today" as a plain string
  // argument, so the system clock never needs mocking — and mocking it
  // anyway would be actively harmful, since fake-indexeddb resolves its
  // internal IndexedDB transaction callbacks via real timer ticks. Faking
  // global timers made every single DB call in this block hang forever.
  it("does nothing when there are no recurring items", async () => {
    await expect(processRecurring("2026-08-06")).resolves.toBeUndefined();
    expect(await db.transactions.count()).toBe(0);
  });

  it("generates a single transaction for an item whose nextDate is today", async () => {
    const categoryId = await makeCategory();
    await db.recurring.add({
      name: "Netflix",
      type: "expense",
      amount: 199,
      categoryId,
      frequency: "monthly",
      startDate: "2026-08-06",
      nextDate: "2026-08-06",
    });

    await processRecurring("2026-08-06");

    const txs = await db.transactions.toArray();
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      amount: 199,
      categoryId,
      date: "2026-08-06",
      merchant: "Netflix",
    });
  });

  it("backfills multiple missed occurrences in one pass (e.g. app not opened for a while)", async () => {
    const categoryId = await makeCategory();
    await db.recurring.add({
      name: "Daily coffee",
      type: "expense",
      amount: 5,
      categoryId,
      frequency: "daily",
      startDate: "2026-08-01",
      nextDate: "2026-08-01",
    });

    await processRecurring("2026-08-05"); // 5 missed days: Aug 1,2,3,4,5

    const txs = await db.transactions.toArray();
    expect(txs).toHaveLength(5);
    expect(txs.map((t) => t.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
  });

  it("advances nextDate past today after backfilling, so it is not regenerated on the next run", async () => {
    const categoryId = await makeCategory();
    const id = await db.recurring.add({
      name: "Rent",
      type: "expense",
      amount: 20000,
      categoryId,
      frequency: "monthly",
      startDate: "2026-08-01",
      nextDate: "2026-08-01",
    });

    await processRecurring("2026-08-06");
    const item = await db.recurring.get(id);
    expect(item?.nextDate).toBe("2026-09-01"); // advanced one month past the single Aug occurrence

    await processRecurring("2026-08-06"); // running again "today" must not duplicate
    expect(await db.transactions.count()).toBe(1);
  });

  it("does not generate anything for a future-dated item", async () => {
    const categoryId = await makeCategory();
    await db.recurring.add({
      name: "Future thing",
      type: "expense",
      amount: 50,
      categoryId,
      frequency: "monthly",
      startDate: "2030-01-01",
      nextDate: "2030-01-01",
    });
    await processRecurring("2026-08-06");
    expect(await db.transactions.count()).toBe(0);
  });

  it("skips paused items entirely", async () => {
    const categoryId = await makeCategory();
    await db.recurring.add({
      name: "Paused subscription",
      type: "expense",
      amount: 99,
      categoryId,
      frequency: "daily",
      startDate: "2026-08-01",
      nextDate: "2026-08-01",
      paused: true,
    });
    await processRecurring("2026-08-06");
    expect(await db.transactions.count()).toBe(0);
  });

  it("processes independent items with different frequencies correctly in the same run", async () => {
    const categoryId = await makeCategory();
    await db.recurring.add({
      name: "Daily",
      type: "expense",
      amount: 1,
      categoryId,
      frequency: "daily",
      startDate: "2026-08-01",
      nextDate: "2026-08-01",
    });
    await db.recurring.add({
      name: "Weekly",
      type: "expense",
      amount: 10,
      categoryId,
      frequency: "weekly",
      startDate: "2026-08-01",
      nextDate: "2026-08-01",
    });

    await processRecurring("2026-08-08"); // 8 days: daily fires 8x, weekly fires 2x (Aug 1, Aug 8)

    const daily = (await db.transactions.toArray()).filter(
      (t) => t.merchant === "Daily",
    );
    const weekly = (await db.transactions.toArray()).filter(
      (t) => t.merchant === "Weekly",
    );
    expect(daily).toHaveLength(8);
    expect(weekly).toHaveLength(2);
  });

  // --- Security regression: DoS via a corrupted/imported recurring row ---
  it(
    "SECURITY: a recurring item with an invalid frequency is skipped without hanging, and other valid items still process",
    { timeout: 5000 }, // generous, but finite — a real hang must fail, not stall the run
    async () => {
      const categoryId = await makeCategory();
      // Simulates a row that arrived via a malformed/imported backup file —
      // bypassing TypeScript's Frequency union with a cast, exactly the way
      // untrusted JSON.parse() output would.
      await db.recurring.add({
        name: "Corrupted",
        type: "expense",
        amount: 1,
        categoryId,
        frequency: "hourly" as Frequency,
        startDate: "2026-08-01",
        nextDate: "2026-08-01",
      });
      await db.recurring.add({
        name: "Healthy",
        type: "expense",
        amount: 2,
        categoryId,
        frequency: "daily",
        startDate: "2026-08-05",
        nextDate: "2026-08-05",
      });

      // If the DoS regressed, this call would hang forever and the test
      // would time out (failing loudly) rather than the whole suite
      // silently never completing.
      await processRecurring("2026-08-06");

      const txs = await db.transactions.toArray();
      // Only the healthy item should have generated anything.
      expect(txs.every((t) => t.merchant === "Healthy")).toBe(true);
      expect(txs.length).toBeGreaterThan(0);

      // The corrupted item's nextDate must be left untouched (not silently
      // advanced), since it never successfully generated anything.
      const all = await db.recurring.toArray();
      const corrupted = all.find((r) => r.name === "Corrupted");
      expect(corrupted?.nextDate).toBe("2026-08-01");
    },
  );
});

describe("getSettings / updateSettings", () => {
  it("creates and returns sensible defaults on first call", async () => {
    const s = await getSettings();
    expect(s).toMatchObject({
      id: 1,
      onboarded: false,
      currency: "₹",
      monthlyIncome: 0,
    });
  });
  it("persists a patch and returns the merged result", async () => {
    await getSettings(); // seed defaults first
    const updated = await updateSettings({
      currency: "$",
      monthlyIncome: 5000,
    });
    expect(updated).toMatchObject({
      currency: "$",
      monthlyIncome: 5000,
      id: 1,
    });
    // and it's actually persisted, not just returned
    const reread = await getSettings();
    expect(reread).toMatchObject({ currency: "$", monthlyIncome: 5000 });
  });
  it("always keeps a single settings row at id=1, never creating duplicates", async () => {
    await updateSettings({ currency: "€" });
    await updateSettings({ currency: "£" });
    expect(await db.settings.count()).toBe(1);
  });
});

describe("ensureDefaultBracketsSeeded", () => {
  it("creates the 4 default brackets (Expenditure/Savings/Investments/Income) when none exist", async () => {
    const map = await ensureDefaultBracketsSeeded();
    expect(Object.keys(map).sort()).toEqual([
      "Expenditure",
      "Income",
      "Investments",
      "Savings",
    ]);
    const brackets = await db.brackets.toArray();
    expect(brackets).toHaveLength(4);
    expect(brackets.find((b) => b.name === "Expenditure")?.kind).toBe("spend");
    expect(brackets.find((b) => b.name === "Savings")?.kind).toBe("allocation");
    expect(brackets.find((b) => b.name === "Investments")?.kind).toBe(
      "allocation",
    );
    expect(brackets.find((b) => b.name === "Income")?.kind).toBe("income");
  });
  it("is a no-op once brackets already exist, and does not duplicate a user-renamed bracket", async () => {
    await ensureDefaultBracketsSeeded();
    await db.brackets.toCollection().modify({ name: "Renamed Bracket" });
    await ensureDefaultBracketsSeeded();
    expect(await db.brackets.count()).toBe(4);
  });
});

describe("ensureIncomeCategoriesSeeded", () => {
  it("seeds the default income categories under the Income bracket when none exist", async () => {
    await ensureIncomeCategoriesSeeded();
    const incomeBracket = await db.brackets
      .where("name")
      .equals("Income")
      .first();
    const incomeCats = await db.categories
      .where("bracketId")
      .equals(incomeBracket!.id!)
      .toArray();
    expect(incomeCats.length).toBeGreaterThan(0);
  });
  it("does not duplicate or overwrite categories the user already customized", async () => {
    const brackets = await ensureDefaultBracketsSeeded();
    await db.categories.add({
      name: "My custom income",
      icon: "💵",
      color: "#000000",
      budget: 0,
      bracketId: brackets["Income"],
    });
    await ensureIncomeCategoriesSeeded();
    const incomeCats = await db.categories
      .where("bracketId")
      .equals(brackets["Income"])
      .toArray();
    expect(incomeCats).toHaveLength(1);
    expect(incomeCats[0].name).toBe("My custom income");
  });
});

describe("computeMonthSummary", () => {
  it("sums only expense transactions against the total spend-bracket category budget for the current month", async () => {
    // Deliberately no fake timers (see the note on processRecurring above —
    // it breaks fake-indexeddb). computeMonthSummary() does read the real
    // system clock internally, so instead of mocking "now" this derives
    // "this month" and "a different month" from the real current date.
    const thisMonthKey = monthKey(todayISO());
    const otherMonthKey = addMonths(thisMonthKey, -2); // guaranteed different regardless of when the suite runs
    const thisMonthDate = `${thisMonthKey}-01`;
    const otherMonthDate = `${otherMonthKey}-01`;

    const expenditureId = await db.brackets.add({
      name: "Expenditure",
      icon: "💳",
      color: "#7C93F0",
      kind: "spend",
    });
    const incomeId = await db.brackets.add({
      name: "Income",
      icon: "💼",
      color: "#6FC98A",
      kind: "income",
    });
    const rentId = await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId: expenditureId,
    });
    const salaryId = await db.categories.add({
      name: "Salary",
      icon: "💼",
      color: "#4FD9B8",
      budget: 0,
      bracketId: incomeId,
    });

    await db.transactions.add({
      type: "expense",
      amount: 15000,
      categoryId: rentId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });
    await db.transactions.add({
      type: "income",
      amount: 50000,
      categoryId: salaryId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });
    // A transaction from a different month must not be counted.
    await db.transactions.add({
      type: "expense",
      amount: 999,
      categoryId: rentId,
      date: otherMonthDate,
      createdAt: Date.now(),
    });

    const summary = await computeMonthSummary();
    expect(summary.spent).toBe(15000);
    expect(summary.budget).toBe(20000); // Income bracket's category budgets excluded
    expect(summary.remaining).toBe(5000);
    expect(summary.monthKey).toBe(thisMonthKey);
  });

  it("excludes allocation-bracket spend (Savings, Investments, EMI…) from both the budget cap and the spent total", async () => {
    const thisMonthDate = `${monthKey(todayISO())}-01`;
    const expenditureId = await db.brackets.add({
      name: "Expenditure",
      icon: "💳",
      color: "#7C93F0",
      kind: "spend",
    });
    const savingsBracketId = await db.brackets.add({
      name: "Savings",
      icon: "💰",
      color: "#4FD9B8",
      kind: "allocation",
    });
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
      budget: 10000,
      bracketId: savingsBracketId,
    });

    await db.transactions.add({
      type: "expense",
      amount: 15000,
      categoryId: rentId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });
    // Money moved into Savings — a transfer, not spend against the cap.
    await db.transactions.add({
      type: "expense",
      amount: 10000,
      categoryId: savingsId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    const summary = await computeMonthSummary();
    expect(summary.spent).toBe(15000); // Savings' 10000 excluded
    expect(summary.budget).toBe(20000); // Savings' target excluded from the cap
    expect(summary.remaining).toBe(5000);
  });

  it("aggregates across multiple spend-kind brackets (e.g. a custom second one alongside Expenditure)", async () => {
    const thisMonthDate = `${monthKey(todayISO())}-01`;
    const expenditureId = await db.brackets.add({
      name: "Expenditure",
      icon: "💳",
      color: "#7C93F0",
      kind: "spend",
    });
    const workExpensesId = await db.brackets.add({
      name: "Work Expenses",
      icon: "💼",
      color: "#F0A83E",
      kind: "spend",
    });
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
      bracketId: workExpensesId,
    });

    await db.transactions.add({
      type: "expense",
      amount: 15000,
      categoryId: rentId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });
    await db.transactions.add({
      type: "expense",
      amount: 3000,
      categoryId: travelId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    const summary = await computeMonthSummary();
    expect(summary.budget).toBe(25000);
    expect(summary.spent).toBe(18000);
  });

  it("excludes an archived category's budget from the cap, but still counts its this-month spend", async () => {
    const thisMonthDate = `${monthKey(todayISO())}-01`;
    const expenditureId = await db.brackets.add({
      name: "Expenditure",
      icon: "💳",
      color: "#7C93F0",
      kind: "spend",
    });
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
      amount: 15000,
      categoryId: rentId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });
    await db.transactions.add({
      type: "expense",
      amount: 1000,
      categoryId: oldGymId,
      date: thisMonthDate,
      createdAt: Date.now(),
    });

    const summary = await computeMonthSummary();
    expect(summary.budget).toBe(20000); // Gym's archived 3000 budget excluded
    expect(summary.spent).toBe(16000); // its historical spend still counts
    expect(summary.remaining).toBe(4000);
  });
});
