import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SplitTracker from "./SplitTracker";
import { db } from "../db/db";

beforeEach(async () => {
  await db.transactions.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.splitShares.clear();
});

function renderTracker() {
  return render(
    <MemoryRouter initialEntries={["/owed"]}>
      <SplitTracker currency="₹" />
    </MemoryRouter>,
  );
}

async function seedDinner(
  amountOwed: number,
  amountSettled = 0,
  personName = "Rahul",
) {
  const bracketId = await db.brackets.add({
    name: "Expenditure",
    icon: "💳",
    color: "#7C93F0",
    kind: "spend",
  });
  const catId = await db.categories.add({
    name: "Food",
    icon: "🍔",
    color: "#F0B94D",
    budget: 10000,
    bracketId,
  });
  const txId = await db.transactions.add({
    type: "expense",
    amount: 1000,
    categoryId: catId,
    date: "2026-08-05",
    createdAt: Date.now(),
    merchant: "Barbeque Nation",
  });
  await db.splitShares.add({
    transactionId: txId,
    personName,
    amountOwed,
    amountSettled,
    createdAt: Date.now(),
  });
  return { txId, catId };
}

describe("SplitTracker — person balances", () => {
  it("shows nobody-owes-you empty state when there are no split shares at all", async () => {
    renderTracker();
    expect(
      await screen.findByText(/Nobody owes you anything/),
    ).toBeInTheDocument();
  });

  it("lists a person with an outstanding balance, and their expense count", async () => {
    await seedDinner(1000);
    renderTracker();

    expect(await screen.findByText("Rahul")).toBeInTheDocument();
    expect((await screen.findAllByText("₹1,000")).length).toBeGreaterThan(0);
    expect(await screen.findByText("1 expense")).toBeInTheDocument();
  });

  it("sums multiple expenses for the same person into one running balance", async () => {
    await seedDinner(1000, 0, "Rahul");
    await seedDinner(500, 0, "Rahul");
    renderTracker();

    expect((await screen.findAllByText("₹1,500")).length).toBeGreaterThan(0);
    expect(await screen.findByText("2 expenses")).toBeInTheDocument();
  });

  it('a fully-settled person moves to the "Settled up" section, not the main outstanding list', async () => {
    await seedDinner(1000, 1000, "Rahul"); // fully paid already
    renderTracker();

    expect(await screen.findByText("Settled up")).toBeInTheDocument();
    // The "People" (outstanding) card still renders its heading — it's
    // empty rather than absent, since there IS split history, just none
    // of it currently owed.
    expect(
      await screen.findByText(/Nobody owes you anything/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Rahul")).toHaveLength(1);
  });

  it("a partially-settled person still shows their remaining outstanding amount, not the original full amount", async () => {
    await seedDinner(1000, 400, "Rahul");
    renderTracker();

    expect((await screen.findAllByText("₹600")).length).toBeGreaterThan(0);
  });
});

describe("SplitTracker — settling a debt never touches transactions or categories", () => {
  it('"Mark as paid" updates amountSettled only — no transaction created, category budget untouched', async () => {
    const { catId } = await seedDinner(1000);
    const user = userEvent.setup();
    renderTracker();

    await user.click(await screen.findByText("Rahul"));
    await user.click(await screen.findByText(/Mark ₹1,000 paid/));

    const shares = await db.splitShares.toArray();
    expect(shares[0].amountSettled).toBe(1000);
    expect(await db.transactions.count()).toBe(1);
    const cat = await db.categories.get(catId);
    expect(cat?.budget).toBe(10000);
  });

  it("recording a partial payment adds to amountSettled rather than replacing it, and clamps at amountOwed", async () => {
    await seedDinner(1000, 400, "Rahul");
    const user = userEvent.setup();
    renderTracker();

    await user.click(await screen.findByText("Rahul"));
    const partialInput = await screen.findByPlaceholderText("Partial");
    await user.type(partialInput, "900");
    await user.click(screen.getByText("Record"));

    const shares = await db.splitShares.toArray();
    expect(shares[0].amountSettled).toBe(1000);
  });

  it('a fully-settled expense shows "Paid" instead of settle actions', async () => {
    await seedDinner(1000, 1000, "Rahul");
    const user = userEvent.setup();
    renderTracker();

    await user.click(await screen.findByText("Rahul"));
    expect(await screen.findByText("Paid")).toBeInTheDocument();
    expect(screen.queryByText(/Mark.*paid/)).not.toBeInTheDocument();
  });
});

describe("SplitTracker — navigation", () => {
  it("tapping a person shows their itemized expenses; the back button returns to the person list", async () => {
    await seedDinner(1000, 0, "Rahul");
    const user = userEvent.setup();
    renderTracker();

    await user.click(await screen.findByText("Rahul"));
    expect(
      await screen.findByText("Barbeque Nation", { exact: false }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Back to Owed to you" }),
    );
    expect(await screen.findByText("People")).toBeInTheDocument();
  });
});
