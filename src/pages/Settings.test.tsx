import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Settings from "./Settings";
import { db, type Settings as SettingsType } from "../db/db";

import { useUIStore } from "../store/useUIStore";
import { clearWidget } from "../lib/widgetSync";

// Only clearWidget is under test here; the real one talks to the native
// widget bridge.
vi.mock("../lib/widgetSync", () => ({
  clearWidget: vi.fn().mockResolvedValue(undefined),
}));

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

    // The real handler uses the custom showConfirm() from the UI store
    // instead of window.confirm() — mock it to auto-accept.
    const { useUIStore } = await import("../store/useUIStore");
    const originalShowConfirm = useUIStore.getState().showConfirm;
    useUIStore.setState({ showConfirm: async () => true });
    try {
      await user.upload(fileInput, backupFile);
    } finally {
      useUIStore.setState({ showConfirm: originalShowConfirm });
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

    const originalShowConfirm = useUIStore.getState().showConfirm;
    useUIStore.setState({ showConfirm: async () => true });
    try {
      await user.upload(fileInput, badFile);
    } finally {
      useUIStore.setState({ showConfirm: originalShowConfirm });
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
    const originalShowConfirm = useUIStore.getState().showConfirm;
    useUIStore.setState({ showConfirm: async () => false }); // person taps Cancel
    try {
      await user.upload(
        fileInput,
        new File([backupJson], "backup.json", { type: "application/json" }),
      );
    } finally {
      useUIStore.setState({ showConfirm: originalShowConfirm });
    }

    expect(screen.queryByText("Backup restored.")).not.toBeInTheDocument();
    expect(await db.categories.count()).toBe(1); // untouched
  });
});

describe("Settings — Erase all data", () => {
  it("wipes everything, including split-expense records and the budget history", async () => {
    const bracketId = await db.brackets.add({ name: "Expenditure", icon: "💳", color: "#7C93F0", kind: "spend" });
    const catId = await db.categories.add({ name: "Dinner", icon: "🍽", color: "#F0B94D", budget: 1000, bracketId });
    const txId = await db.transactions.add({ type: "expense", amount: 500, categoryId: catId, date: "2026-10-01", createdAt: 0 });
    await db.splitShares.add({ transactionId: txId, personName: "Rahul", amountOwed: 250, amountSettled: 0, createdAt: 0 });
    await db.budgetHistory.add({ categoryId: catId, month: "2026-10", budget: 1000, origin: "migrated", createdAt: 0 });

    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const originalShowConfirm = useUIStore.getState().showConfirm;
    useUIStore.setState({ showConfirm: async () => true });
    try {
      const user = userEvent.setup();
      renderSettings();
      await user.click(await screen.findByText("Erase all data"));
      await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    } finally {
      useUIStore.setState({ showConfirm: originalShowConfirm });
      vi.unstubAllGlobals();
    }

    expect(await db.transactions.count()).toBe(0);
    expect(await db.categories.count()).toBe(0);
    expect(await db.brackets.count()).toBe(0);
    expect(await db.splitShares.count()).toBe(0);
    expect(await db.budgetHistory.count()).toBe(0);
  });
});

describe("Settings — Erase all data: widget and failure handling", () => {
  it("blanks the home-screen widget as part of erasing", async () => {
    vi.mocked(clearWidget).mockClear();
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const originalShowConfirm = useUIStore.getState().showConfirm;
    useUIStore.setState({ showConfirm: async () => true });
    try {
      const user = userEvent.setup();
      renderSettings();
      await user.click(await screen.findByText("Erase all data"));
      await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    } finally {
      useUIStore.setState({ showConfirm: originalShowConfirm });
      vi.unstubAllGlobals();
    }
    expect(clearWidget).toHaveBeenCalledTimes(1);
  });

  it("does not reload or blank the widget when the erase itself fails, and says so", async () => {
    vi.mocked(clearWidget).mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const txSpy = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("IDB failure"));
    const originalShowConfirm = useUIStore.getState().showConfirm;
    useUIStore.setState({ showConfirm: async () => true });
    try {
      const user = userEvent.setup();
      renderSettings();
      await user.click(await screen.findByText("Erase all data"));
      await vi.waitFor(() =>
        expect(useUIStore.getState().toastMsg).toMatch(/couldn't erase/i),
      );
    } finally {
      txSpy.mockRestore();
      useUIStore.setState({ showConfirm: originalShowConfirm });
      vi.unstubAllGlobals();
    }
    expect(reload).not.toHaveBeenCalled();
    expect(clearWidget).not.toHaveBeenCalled();
  });
});

describe("Settings — backup tracking", () => {
  it('shows "Never" until a backup is exported', async () => {
    renderSettings();
    expect(await screen.findByText("Never")).toBeInTheDocument();
  });

  it("records the time of a successful export and tells the app", async () => {
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const onSettingsChange = vi.fn();
    const before = Date.now();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Settings settings={baseSettings} onSettingsChange={onSettingsChange} />
      </MemoryRouter>,
    );

    await user.click(await screen.findByText("Export backup (.json)"));

    await vi.waitFor(async () => {
      const saved = await db.settings.get(1);
      expect(saved?.lastBackupAt).toBeGreaterThanOrEqual(before);
    });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ lastBackupAt: expect.any(Number) }),
    );
  });

  it("shows how long ago the last backup was", async () => {
    render(
      <MemoryRouter>
        <Settings
          settings={{ ...baseSettings, lastBackupAt: Date.now() - 5 * 86400000 }}
          onSettingsChange={() => {}}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText("5 days ago")).toBeInTheDocument();
  });
});
