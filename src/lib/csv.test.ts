import { describe, it, expect, beforeEach } from "vitest";
import Papa from "papaparse";
import { db } from "../db/db";
import {
  exportTransactionsCSV,
  exportCategoriesCSV,
  exportBracketsCSV,
  exportMonthlySummaryCSV,
  exportFullBackup,
  importFullBackup,
  SCHEMA_VERSION,
} from "./csv";

beforeEach(async () => {
  await db.transactions.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.recurring.clear();
  await db.settings.clear();
});

function parseCsv(csv: string): Record<string, string>[] {
  return Papa.parse(csv, { header: true, skipEmptyLines: true }).data as Record<
    string,
    string
  >[];
}

async function makeExpenditureBracket() {
  return db.brackets.add({
    name: "Expenditure",
    icon: "💳",
    color: "#7C93F0",
    kind: "spend",
  });
}

describe("CSV export — formula injection protection", () => {
  it('prefixes a category name starting with "=" so spreadsheet apps treat it as text, not a formula', async () => {
    const bracketId = await makeExpenditureBracket();
    await db.categories.add({
      name: '=cmd|"/C calc"!A1',
      icon: "🏠",
      color: "#F0B94D",
      budget: 0,
      bracketId,
    });
    const rows = parseCsv(await exportCategoriesCSV());
    expect(rows[0].Name.startsWith("'")).toBe(true);
    expect(rows[0].Name).toBe('\'=cmd|"/C calc"!A1');
  });

  it.each(["=", "+", "-", "@"])(
    'sanitizes a merchant field starting with "%s"',
    async (prefix) => {
      const bracketId = await makeExpenditureBracket();
      const catId = await db.categories.add({
        name: "Shopping",
        icon: "🛍️",
        color: "#E8618C",
        budget: 0,
        bracketId,
      });
      await db.transactions.add({
        type: "expense",
        amount: 100,
        categoryId: catId,
        date: "2026-08-06",
        merchant: `${prefix}HYPERLINK("http://evil.example")`,
        createdAt: Date.now(),
      });
      const rows = parseCsv(await exportTransactionsCSV());
      expect(rows[0].Merchant.startsWith("'")).toBe(true);
    },
  );

  it("leaves ordinary text completely unmodified", async () => {
    const bracketId = await makeExpenditureBracket();
    await db.categories.add({
      name: "Groceries",
      icon: "🍲",
      color: "#6FC98A",
      budget: 0,
      bracketId,
    });
    const rows = parseCsv(await exportCategoriesCSV());
    expect(rows[0].Name).toBe("Groceries");
  });

  it("does not falsely flag text that merely contains, but does not start with, a trigger character", async () => {
    const bracketId = await makeExpenditureBracket();
    await db.categories.add({
      name: "Coffee @ Home",
      icon: "☕",
      color: "#6FC98A",
      budget: 0,
      bracketId,
    });
    const rows = parseCsv(await exportCategoriesCSV());
    expect(rows[0].Name).toBe("Coffee @ Home");
  });
});

describe("exportCategoriesCSV / exportBracketsCSV — bracket dimension columns", () => {
  it("tags each category row with its bracket id/name/kind, so a spend cap and an allocation target are never silently averaged together", async () => {
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
    await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId: expenditureId,
    });
    await db.categories.add({
      name: "Savings",
      icon: "💰",
      color: "#4FD9B8",
      budget: 10000,
      bracketId: savingsBracketId,
    });

    const rows = parseCsv(await exportCategoriesCSV());
    const rentRow = rows.find((r) => r.Name === "Rent");
    const savingsRow = rows.find((r) => r.Name === "Savings");
    expect(rentRow?.BracketKind).toBe("spend");
    expect(rentRow?.BracketName).toBe("Expenditure");
    expect(savingsRow?.BracketKind).toBe("allocation");
    expect(savingsRow?.BracketName).toBe("Savings");
  });

  it("exports a bracket dimension table with kind and id", async () => {
    await db.brackets.add({
      name: "Investments",
      icon: "📈",
      color: "#B98CF0",
      kind: "allocation",
    });
    const rows = parseCsv(await exportBracketsCSV());
    expect(rows[0].Name).toBe("Investments");
    expect(rows[0].Kind).toBe("allocation");
  });
});

describe("exportMonthlySummaryCSV — bracket columns distinguish budget caps from allocation targets", () => {
  it("tags each row with its bracket kind, so a spend cap and an allocation target are never silently averaged together", async () => {
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
      date: "2026-08-05",
      createdAt: Date.now(),
    });
    await db.transactions.add({
      type: "expense",
      amount: 10000,
      categoryId: savingsId,
      date: "2026-08-05",
      createdAt: Date.now(),
    });

    const rows = parseCsv(await exportMonthlySummaryCSV());
    const rentRow = rows.find((r) => r.CategoryName === "Rent");
    const savingsRow = rows.find((r) => r.CategoryName === "Savings");
    expect(rentRow?.BracketKind).toBe("spend");
    expect(savingsRow?.BracketKind).toBe("allocation");
  });
});

describe("importFullBackup — structural validation", () => {
  it("rejects a payload that is not valid JSON", async () => {
    await expect(importFullBackup("not json{{{")).rejects.toThrow();
  });
  it("rejects a JSON payload missing the categories array", async () => {
    await expect(
      importFullBackup(JSON.stringify({ transactions: [] })),
    ).rejects.toThrow("Invalid backup file");
  });
  it("rejects a JSON payload missing the transactions array", async () => {
    await expect(
      importFullBackup(JSON.stringify({ categories: [] })),
    ).rejects.toThrow("Invalid backup file");
  });
  it("rejects a bare JSON array (not an object)", async () => {
    await expect(importFullBackup("[]")).rejects.toThrow("Invalid backup file");
  });

  it("SECURITY: rejects a backup whose schemaVersion is newer than this app understands", async () => {
    const payload = JSON.stringify({
      schemaVersion: SCHEMA_VERSION + 1,
      categories: [],
      transactions: [],
    });
    await expect(importFullBackup(payload)).rejects.toThrow(/newer version/i);
    // and critically: nothing should have been written
    expect(await db.categories.count()).toBe(0);
  });

  it("accepts a backup with no schemaVersion field at all (legacy/hand-built file)", async () => {
    const payload = JSON.stringify({ categories: [], transactions: [] });
    await expect(importFullBackup(payload)).resolves.toBeUndefined();
  });

  it("SECURITY: rejects an oversized payload rather than attempting to import it", async () => {
    const hugeArray = Array.from({ length: 200_001 }, (_, i) => ({
      name: `Cat ${i}`,
    }));
    const payload = JSON.stringify({ categories: hugeArray, transactions: [] });
    await expect(importFullBackup(payload)).rejects.toThrow(/too large/i);
  });
});

describe("importFullBackup — pre-v5 legacy backups (no brackets array)", () => {
  it("synthesizes the 4 default brackets and assigns categories by their old flow/type/name, matching the live Dexie v4 migration", async () => {
    const payload = JSON.stringify({
      schemaVersion: 4,
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
          name: "Salary",
          icon: "💼",
          color: "#4FD9B8",
          budget: 0,
          flow: "income",
        },
        {
          id: 3,
          name: "Investments",
          icon: "📈",
          color: "#B98CF0",
          budget: 5000,
          flow: "allocation",
        },
        {
          id: 4,
          name: "Savings",
          icon: "💰",
          color: "#4FD9B8",
          budget: 3000,
          flow: "allocation",
        },
      ],
      transactions: [],
    });
    await importFullBackup(payload);

    const brackets = await db.brackets.toArray();
    expect(brackets.map((b) => b.name).sort()).toEqual([
      "Expenditure",
      "Income",
      "Investments",
      "Savings",
    ]);

    const cats = await db.categories.toArray();
    const bracketById = new Map(brackets.map((b) => [b.id, b]));
    const rent = cats.find((c) => c.name === "Rent")!;
    const salary = cats.find((c) => c.name === "Salary")!;
    const investments = cats.find((c) => c.name === "Investments")!;
    const savings = cats.find((c) => c.name === "Savings")!;
    expect(bracketById.get(rent.bracketId)?.name).toBe("Expenditure");
    expect(bracketById.get(salary.bracketId)?.name).toBe("Income");
    expect(bracketById.get(investments.bracketId)?.name).toBe("Investments");
    expect(bracketById.get(savings.bracketId)?.name).toBe("Savings");
  });

  it("an even older (pre-v4) backup using `type` instead of `flow` still imports correctly", async () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      categories: [
        {
          id: 1,
          name: "Rent",
          icon: "🏠",
          color: "#F0B94D",
          budget: 20000,
          type: "expense",
        },
        {
          id: 2,
          name: "Salary",
          icon: "💼",
          color: "#4FD9B8",
          budget: 0,
          type: "income",
        },
      ],
      transactions: [],
    });
    await importFullBackup(payload);
    const brackets = await db.brackets.toArray();
    const cats = await db.categories.toArray();
    const bracketById = new Map(brackets.map((b) => [b.id, b]));
    expect(
      bracketById.get(cats.find((c) => c.name === "Rent")!.bracketId)?.kind,
    ).toBe("spend");
    expect(
      bracketById.get(cats.find((c) => c.name === "Salary")!.bracketId)?.kind,
    ).toBe("income");
  });
});

describe("importFullBackup — field sanitization (untrusted data)", () => {
  it('SECURITY: coerces a non-hex-color category "color" to the safe fallback instead of passing it through', async () => {
    const payload = JSON.stringify({
      categories: [
        {
          name: "Evil",
          color: "url(https://evil.example/pixel.gif)",
          type: "expense",
        },
      ],
      transactions: [],
    });
    await importFullBackup(payload);
    const cat = (await db.categories.toArray())[0];
    expect(cat.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("accepts a well-formed hex color unchanged", async () => {
    const payload = JSON.stringify({
      categories: [{ name: "Fine", color: "#AB12CD", type: "expense" }],
      transactions: [],
    });
    await importFullBackup(payload);
    expect((await db.categories.toArray())[0].color).toBe("#AB12CD");
  });

  it("SECURITY: coerces a non-finite category budget (a non-numeric string, or null from a value JSON can't represent) to 0 instead of letting it propagate", async () => {
    const payload = JSON.stringify({
      categories: [
        { name: "A", budget: "not a number", type: "expense" },
        { name: "B", budget: Infinity, type: "expense" }, // JSON.stringify turns this into `null` — same "not a finite number" path
      ],
      transactions: [],
    });
    await importFullBackup(payload);
    const cats = await db.categories.toArray();
    expect(cats.every((c) => Number.isFinite(c.budget))).toBe(true);
    expect(cats[0].budget).toBe(0);
  });

  it("SECURITY: coerces a negative amount to a non-negative value", async () => {
    const catPayload = JSON.stringify({
      categories: [{ name: "A", budget: -500, type: "expense" }],
      transactions: [],
    });
    await importFullBackup(catPayload);
    expect((await db.categories.toArray())[0].budget).toBeGreaterThanOrEqual(0);
  });

  it('falls back to "Uncategorized" for a category with a blank/missing name', async () => {
    const payload = JSON.stringify({
      categories: [{ name: "   " }],
      transactions: [],
    });
    await importFullBackup(payload);
    expect((await db.categories.toArray())[0].name).toBe("Uncategorized");
  });

  it("truncates an absurdly long text field instead of storing it unbounded", async () => {
    const payload = JSON.stringify({
      categories: [{ name: "A".repeat(10_000), type: "expense" }],
      transactions: [],
    });
    await importFullBackup(payload);
    expect((await db.categories.toArray())[0].name.length).toBeLessThanOrEqual(
      60,
    );
  });

  it('SECURITY: coerces an unrecognized recurring "frequency" to a safe default instead of leaving it invalid', async () => {
    // This is the field-level guard that backs up the throw-on-invalid-
    // frequency fix in db.ts — even if that defense were ever removed, a
    // corrupted import couldn't reach an invalid Frequency value at all.
    const payload = JSON.stringify({
      categories: [],
      transactions: [],
      recurring: [{ name: "Bad", frequency: "hourly", categoryId: 1 }],
    });
    await importFullBackup(payload);
    const rec = (await db.recurring.toArray())[0];
    expect(["daily", "weekly", "monthly", "yearly"]).toContain(rec.frequency);
  });

  it("rejects an invalid date string and substitutes today instead of storing garbage", async () => {
    const payload = JSON.stringify({
      categories: [],
      transactions: [],
      recurring: [
        {
          name: "X",
          frequency: "monthly",
          nextDate: "not-a-date",
          startDate: "also-bad",
          categoryId: 1,
        },
      ],
    });
    await importFullBackup(payload);
    const rec = (await db.recurring.toArray())[0];
    expect(rec.nextDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("drops non-string entries out of a tags array rather than storing malformed data", async () => {
    const payload = JSON.stringify({
      categories: [],
      recurring: [],
      transactions: [
        {
          type: "expense",
          amount: 10,
          categoryId: 1,
          date: "2026-08-06",
          tags: ["ok", 42, null, "fine"],
        },
      ],
    });
    await importFullBackup(payload);
    const tx = (await db.transactions.toArray())[0];
    expect(tx.tags).toEqual(["ok", "fine"]);
  });

  it("handles a non-object entry inside an array gracefully instead of throwing", async () => {
    const payload = JSON.stringify({
      categories: ["not an object", null, 42],
      transactions: [],
    });
    await expect(importFullBackup(payload)).resolves.toBeUndefined();
    const cats = await db.categories.toArray();
    expect(cats).toHaveLength(3); // sanitized in place, not dropped
    expect(cats.every((c) => typeof c.name === "string")).toBe(true);
  });
});

describe("importFullBackup — bracket/category/recurring id remapping", () => {
  it("SECURITY/CORRECTNESS: preserves the category-transaction link correctly even on a device that has been used for a while (auto-increment counter already advanced past 1)", async () => {
    // IndexedDB's key generator is NOT reset by clear() — confirmed
    // empirically against fake-indexeddb. Simulate that drift explicitly
    // instead of relying on a fresh test DB coincidentally starting at 1,
    // which would hide exactly this bug.
    const churnBracketId = await makeExpenditureBracket();
    const churnId = await db.categories.add({
      name: "Temp",
      icon: "🗑️",
      color: "#000000",
      budget: 0,
      bracketId: churnBracketId,
    });
    await db.categories.delete(churnId); // counter has now advanced past 1

    const expenditureId = await makeExpenditureBracket();
    const rentId = await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId: expenditureId,
    });
    await db.transactions.add({
      type: "expense",
      amount: 15000,
      categoryId: rentId,
      date: "2026-08-05",
      createdAt: Date.now(),
    });

    const backup = await exportFullBackup();
    await db.transactions.clear();
    await db.categories.clear();
    await db.brackets.clear();

    await importFullBackup(backup);

    const restoredCat = (await db.categories.toArray())[0];
    const restoredTx = (await db.transactions.toArray())[0];
    const restoredBrackets = await db.brackets.toArray();
    const restoredBracket = restoredBrackets.find(
      (b) => b.id === restoredCat.bracketId,
    );
    // The whole point: even though the re-inserted category's new id is
    // guaranteed to NOT equal its old id (rentId) after the churn above,
    // the transaction must still correctly point at it, and the category
    // must still correctly point at its (also re-inserted) bracket.
    expect(restoredCat.id).not.toBe(rentId);
    expect(restoredTx.categoryId).toBe(restoredCat.id);
    expect(restoredBracket).toBeDefined();
    expect(restoredCat.name).toBe("Rent");
  });

  it("gracefully leaves categoryId unresolved (rather than crashing) when a transaction references a category absent from the backup", async () => {
    const payload = JSON.stringify({
      categories: [{ id: 1, name: "A", type: "expense" }],
      transactions: [
        { type: "expense", amount: 10, categoryId: 999, date: "2026-08-06" },
      ], // 999 doesn't exist
    });
    await expect(importFullBackup(payload)).resolves.toBeUndefined();
    const tx = (await db.transactions.toArray())[0];
    // Parked on 0 ("no category") — the rest of the app already treats any
    // non-matching categoryId as "Uncategorized" everywhere it's displayed,
    // so this is a safe, non-crashing degradation.
    expect(tx.categoryId).toBe(0);
  });

  it("never lets a transaction with an unknown category land on a real one whose new id happens to match the old number", async () => {
    // Category ids are re-assigned on restore. Probe what the next id will
    // be, then make the stray transaction point at exactly that number —
    // an id that is absent from the backup but WILL exist after restore.
    const probe = await db.categories.add({
      name: "probe",
      icon: "x",
      color: "#000000",
      budget: 0,
      bracketId: 0,
    });
    await db.categories.delete(probe);
    const collidingId = probe + 1;

    const payload = JSON.stringify({
      categories: [
        { id: 10, name: "A", type: "expense" },
        { id: 11, name: "B", type: "expense" },
      ],
      transactions: [
        { type: "expense", amount: 10, categoryId: collidingId, date: "2026-08-06" },
      ],
    });
    await importFullBackup(payload);
    const cats = await db.categories.toArray();
    const tx = (await db.transactions.toArray())[0];
    expect(cats.map((c) => c.id)).toContain(collidingId); // a real category now has that id
    expect(tx.categoryId).toBe(0); // ...but the stray transaction is not attached to it
  });

  it("restores settings onto row 1 even after the table's auto-increment counter has moved on", async () => {
    // Simulates a device that has already run (counter past 1) — the case
    // every real restore hits.
    await db.settings.put({
      id: 1, onboarded: true, currency: "₹", theme: "dark",
      monthlyIncome: 0, carryForward: false, hideWidgetAmounts: true,
    });
    await db.settings.clear();
    await importFullBackup(
      JSON.stringify({
        categories: [],
        transactions: [],
        settings: [
          { id: 7, onboarded: true, currency: "$", theme: "light", monthlyIncome: 5000 },
        ],
      }),
    );
    const restored = await db.settings.get(1);
    expect(restored).toMatchObject({
      onboarded: true,
      currency: "$",
      theme: "light",
      monthlyIncome: 5000,
    });
    expect(await db.settings.count()).toBe(1);
  });

  it("restores widget privacy: a backup without the setting comes back masked, an explicit false stays false", async () => {
    await importFullBackup(
      JSON.stringify({
        categories: [],
        transactions: [],
        settings: [{ id: 1, onboarded: true, currency: "₹", theme: "dark" }],
      }),
    );
    expect((await db.settings.get(1))?.hideWidgetAmounts).toBe(true);

    await db.settings.clear();
    await importFullBackup(
      JSON.stringify({
        categories: [],
        transactions: [],
        settings: [
          { id: 1, onboarded: true, currency: "₹", theme: "dark", hideWidgetAmounts: false },
        ],
      }),
    );
    expect((await db.settings.get(1))?.hideWidgetAmounts).toBe(false);
  });
});

describe("importFullBackup — end-to-end round trip", () => {
  it("a full export (including brackets) can be imported back and reproduces the same data", async () => {
    const bracketId = await makeExpenditureBracket();
    const catId = await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId,
    });
    await db.transactions.add({
      type: "expense",
      amount: 15000,
      categoryId: catId,
      date: "2026-08-05",
      createdAt: Date.now(),
    });
    await db.recurring.add({
      name: "Rent",
      type: "expense",
      amount: 20000,
      categoryId: catId,
      frequency: "monthly",
      startDate: "2026-08-01",
      nextDate: "2026-09-01",
    });

    const backup = await exportFullBackup();

    await db.transactions.clear();
    await db.categories.clear();
    await db.brackets.clear();
    await db.recurring.clear();

    await importFullBackup(backup);

    expect(await db.brackets.count()).toBe(1);
    expect(await db.categories.count()).toBe(1);
    expect(await db.transactions.count()).toBe(1);
    expect(await db.recurring.count()).toBe(1);
    const restoredCat = (await db.categories.toArray())[0];
    expect(restoredCat.name).toBe("Rent");
    const restoredTx = (await db.transactions.toArray())[0];
    expect(restoredTx.amount).toBe(15000);
    // The imported transaction's categoryId must still resolve to the
    // re-inserted category (position-based id remap, see csv.ts).
    expect(restoredTx.categoryId).toBe(restoredCat.id);
  });

  it("completely replaces existing data rather than merging with it", async () => {
    const bracketId = await makeExpenditureBracket();
    await db.categories.add({
      name: "Old category",
      icon: "🗑️",
      color: "#000000",
      budget: 0,
      bracketId,
    });
    const payload = JSON.stringify({
      categories: [{ name: "New category", type: "expense" }],
      transactions: [],
    });
    await importFullBackup(payload);
    const cats = await db.categories.toArray();
    expect(cats).toHaveLength(1);
    expect(cats[0].name).toBe("New category");
  });
});
