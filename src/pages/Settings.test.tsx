import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Settings from "./Settings";
import { db, type Settings as SettingsType } from "../db/db";

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

const baseSettings: SettingsType = {
  id: 1,
  onboarded: true,
  currency: "₹",
  theme: "dark",
  monthlyIncome: 0,
  carryForward: false,
  hideWidgetAmounts: false,
};

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings settings={baseSettings} onSettingsChange={() => {}} />
    </MemoryRouter>,
  );
}

describe("Settings — Brackets list (no per-category flow toggle)", () => {
  it('shows an empty state and an "Add bracket" affordance when no brackets exist yet', async () => {
    renderSettings();
    expect(
      await screen.findByText(/None yet\. Add one below\./i),
    ).toBeInTheDocument();
    expect(screen.getByText("Add bracket")).toBeInTheDocument();
  });

  it('creating a bracket with kind "Allocation" persists the correct kind, with no per-category toggle involved', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByText("Add bracket"));
    await user.type(
      screen.getByPlaceholderText("Bracket name (e.g. EMI)"),
      "EMI",
    );
    await user.click(screen.getByRole("button", { name: "Allocation" }));
    await user.click(screen.getByText("Create bracket"));

    const saved = await db.brackets.toArray();
    const emi = saved.find((b) => b.name === "EMI");
    expect(emi?.kind).toBe("allocation");
  });

  it('creating a bracket defaults to kind "spend" (Budget cap) if left unchanged', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByText("Add bracket"));
    await user.type(
      screen.getByPlaceholderText("Bracket name (e.g. EMI)"),
      "Groceries Fund",
    );
    await user.click(screen.getByText("Create bracket"));

    const saved = await db.brackets.toArray();
    expect(saved.find((b) => b.name === "Groceries Fund")?.kind).toBe("spend");
  });

  it("an existing bracket renders as a row with its kind and category count, and no editable category fields inline — editing happens on its own page", async () => {
    const expenditureId = await db.brackets.add({
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
      bracketId: expenditureId,
    });
    await db.brackets.add({
      name: "Savings",
      icon: "💰",
      color: "#4FD9B8",
      kind: "allocation",
    });

    renderSettings();

    expect(await screen.findByText("Expenditure")).toBeInTheDocument();
    expect(screen.getByText(/Budget cap · 1 category/)).toBeInTheDocument();
    expect(screen.getByText("Savings")).toBeInTheDocument();
    expect(screen.getByText(/Allocation · 0 categories/)).toBeInTheDocument();
    // No inline category-editing inputs on this page anymore.
    expect(screen.queryByPlaceholderText("Category")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Rent")).not.toBeInTheDocument();
  });

  it("shows a validation toast rather than creating an unnamed bracket", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByText("Add bracket"));
    await user.click(screen.getByText("Create bracket"));

    expect(await db.brackets.count()).toBe(0);
  });
});
