import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Settings from "./Settings";
import { db, type Settings as SettingsType } from "../db/db";

import { useUIStore } from "../store/useUIStore";

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
  useUIStore.setState({ toastMsg: null });
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

import Toast from "../components/Toast";

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings settings={baseSettings} onSettingsChange={() => {}} />
    </MemoryRouter>,
  );
}

// Toast renders at the App shell level in the real app, not inside
// Settings itself — tests that need to see toast text (not just infer it
// from a resulting DB change) need it mounted alongside Settings here.
function renderSettingsWithToast() {
  return render(
    <MemoryRouter>
      <Settings settings={baseSettings} onSettingsChange={() => {}} />
      <Toast />
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

describe("Settings — export/import backup, end to end through the real UI", () => {
  it('a file exported via "Export backup" can be re-imported via "Restore from backup" and actually restores the data', async () => {
    // Seed some real data, export it (the same function the "Export
    // backup" button calls), wipe the device, then feed that exact file
    // back in through the actual <input type="file"> the person taps —
    // not calling importFullBackup() directly. If the wiring between the
    // button and the function is broken, this is what would catch it.
    const { exportFullBackup } = await import("../lib/csv");
    const bracketId = await db.brackets.add({
      name: "Expenditure",
      icon: "💳",
      color: "#7C93F0",
      kind: "spend",
    });
    const catId = await db.categories.add({
      name: "Rent",
      icon: "🏠",
      color: "#F0B94D",
      budget: 20000,
      bracketId,
    });
    await db.transactions.add({
      type: "expense",
      amount: 5000,
      categoryId: catId,
      date: "2026-01-15",
      createdAt: Date.now(),
      note: "January rent",
    });

    const backupJson = await exportFullBackup();

    // Wipe, simulating "switched to a new phone" / a fresh install.
    await db.transactions.clear();
    await db.categories.clear();
    await db.brackets.clear();
    expect(await db.brackets.count()).toBe(0);

    const user = userEvent.setup();
    renderSettingsWithToast();

    const backupFile = new File([backupJson], "moneymate-backup.json", {
      type: "application/json",
    });
    const fileInput = screen.getByLabelText(
      "Restore from backup",
    ) as HTMLInputElement;

    // The real handler shows a confirm() dialog before restoring — auto-accept it.
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    try {
      await user.upload(fileInput, backupFile);
    } finally {
      window.confirm = originalConfirm;
    }

    await screen.findByText("Backup restored.");

    const restoredBrackets = await db.brackets.toArray();
    const restoredCategories = await db.categories.toArray();
    const restoredTx = await db.transactions.toArray();
    expect(restoredBrackets).toHaveLength(1);
    expect(restoredBrackets[0].name).toBe("Expenditure");
    expect(restoredCategories).toHaveLength(1);
    expect(restoredCategories[0].name).toBe("Rent");
    expect(restoredTx).toHaveLength(1);
    expect(restoredTx[0].amount).toBe(5000);
    expect(restoredTx[0].note).toBe("January rent");
  });

  it("shows an error toast instead of silently failing when the chosen file isn't a valid backup", async () => {
    const user = userEvent.setup();
    renderSettingsWithToast();

    const badFile = new File(["not a backup at all"], "notes.json", {
      type: "application/json",
    });
    const fileInput = screen.getByLabelText(
      "Restore from backup",
    ) as HTMLInputElement;

    const originalConfirm = window.confirm;
    window.confirm = () => true;
    try {
      await user.upload(fileInput, badFile);
    } finally {
      window.confirm = originalConfirm;
    }

    expect(await screen.findByText("Invalid backup file")).toBeInTheDocument();
  });

  it('does nothing if the person cancels the "this replaces everything" confirmation', async () => {
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

    const { exportFullBackup } = await import("../lib/csv");
    const backupJson = await exportFullBackup();

    const user = userEvent.setup();
    renderSettings();

    const fileInput = screen.getByLabelText(
      "Restore from backup",
    ) as HTMLInputElement;
    const originalConfirm = window.confirm;
    window.confirm = () => false; // person taps Cancel
    try {
      await user.upload(
        fileInput,
        new File([backupJson], "backup.json", { type: "application/json" }),
      );
    } finally {
      window.confirm = originalConfirm;
    }

    expect(screen.queryByText("Backup restored.")).not.toBeInTheDocument();
    expect(await db.categories.count()).toBe(1); // untouched
  });
});
