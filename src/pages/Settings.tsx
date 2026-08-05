import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  type Category,
  type Recurring,
  type Frequency,
  updateSettings,
  type Settings as SettingsType,
  ensureIncomeCategoriesSeeded,
} from "../db/db";
import { X } from "lucide-react";
import Dropdown from "../components/Dropdown";
import {
  exportFullBackup,
  exportTransactionsCSV,
  exportCategoriesCSV,
  exportMonthlySummaryCSV,
  exportMLDatasetJSON,
  importFullBackup,
  downloadFile,
} from "../lib/csv";
import { todayISO } from "../lib/format";
import { useUIStore } from "../store/useUIStore";
import IconPicker from "../components/IconPicker";

const PALETTE = [
  "#F0B94D",
  "#4FD9B8",
  "#7C93F0",
  "#E8618C",
  "#B98CF0",
  "#F0A83E",
  "#FF6B6B",
  "#6FC98A",
];

export default function Settings({
  settings,
  onSettingsChange,
}: {
  settings: SettingsType;
  onSettingsChange: (s: SettingsType) => void;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const recurring = useLiveQuery(() => db.recurring.toArray(), []) ?? [];
  const expenseCategories = categories.filter((c) => c.type !== "income");
  const incomeCategories = categories.filter((c) => c.type === "income");

  const [draftCats, setDraftCats] = useState<Category[]>([]);
  useEffect(
    () => setDraftCats(expenseCategories),
    [categories.length, JSON.stringify(expenseCategories.map((c) => c.id))],
  );

  function updateCat(i: number, field: keyof Category, val: string | number) {
    setDraftCats((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)),
    );
  }
  function addCat() {
    setDraftCats((prev) => [
      ...prev,
      {
        name: "",
        icon: "＊",
        color: PALETTE[prev.length % PALETTE.length],
        budget: 0,
        type: "expense",
      },
    ]);
  }
  async function removeCat(i: number) {
    const cat = draftCats[i];
    if (cat.id) await db.categories.delete(cat.id);
    setDraftCats((prev) => prev.filter((_, idx) => idx !== i));
  }
  async function saveCats() {
    for (const c of draftCats) {
      if (!c.name.trim()) continue;
      if (c.id)
        await db.categories.update(c.id, {
          name: c.name.trim(),
          budget: Number(c.budget) || 0,
          icon: c.icon,
          color: c.color,
          type: "expense",
        });
      else
        await db.categories.add({
          name: c.name.trim(),
          budget: Number(c.budget) || 0,
          icon: c.icon,
          color: c.color,
          type: "expense",
        });
    }
    showToast("Budgets saved.");
  }

  // Income categories — separate from expense budgets entirely; no budget field applies here.
  const [draftIncomeCats, setDraftIncomeCats] = useState<Category[]>([]);
  useEffect(
    () => setDraftIncomeCats(incomeCategories),
    [categories.length, JSON.stringify(incomeCategories.map((c) => c.id))],
  );

  function updateIncomeCat(
    i: number,
    field: keyof Category,
    val: string | number,
  ) {
    setDraftIncomeCats((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)),
    );
  }
  function addIncomeCat() {
    setDraftIncomeCats((prev) => [
      ...prev,
      {
        name: "",
        icon: "💰",
        color: PALETTE[prev.length % PALETTE.length],
        budget: 0,
        type: "income",
      },
    ]);
  }
  async function removeIncomeCat(i: number) {
    const cat = draftIncomeCats[i];
    if (cat.id) await db.categories.delete(cat.id);
    setDraftIncomeCats((prev) => prev.filter((_, idx) => idx !== i));
  }
  async function saveIncomeCats() {
    for (const c of draftIncomeCats) {
      if (!c.name.trim()) continue;
      if (c.id)
        await db.categories.update(c.id, {
          name: c.name.trim(),
          icon: c.icon,
          color: c.color,
          type: "income",
        });
      else
        await db.categories.add({
          name: c.name.trim(),
          budget: 0,
          icon: c.icon,
          color: c.color,
          type: "income",
        });
    }
    showToast("Income sources saved.");
  }

  // Recurring
  const [rName, setRName] = useState("");
  const [rAmount, setRAmount] = useState("");
  const [rCat, setRCat] = useState<number | null>(null);
  const [rFreq, setRFreq] = useState<Frequency>("monthly");
  const [rType, setRType] = useState<"expense" | "income">("expense");

  async function addRecurring() {
    const amt = parseFloat(rAmount);
    if (!rName.trim() || !amt || !rCat) {
      showToast("Fill in name, amount, and category.");
      return;
    }
    await db.recurring.add({
      name: rName.trim(),
      amount: amt,
      categoryId: rCat,
      frequency: rFreq,
      type: rType,
      startDate: todayISO(),
      nextDate: todayISO(),
    });
    setRName("");
    setRAmount("");
    showToast("Recurring item added — it will post automatically.");
  }
  async function togglePause(r: Recurring) {
    await db.recurring.update(r.id!, { paused: !r.paused });
  }
  async function deleteRecurring(id: number) {
    await db.recurring.delete(id);
  }

  // Preferences
  const [incomeDraft, setIncomeDraft] = useState(
    String(settings.monthlyIncome || ""),
  );
  async function setCurrency(c: string) {
    const next = await updateSettings({ currency: c });
    onSettingsChange(next);
  }
  async function setTheme(t: SettingsType["theme"]) {
    const next = await updateSettings({ theme: t });
    onSettingsChange(next);
  }
  async function saveIncome() {
    const val = parseFloat(incomeDraft) || 0;
    if (val > 0) await ensureIncomeCategoriesSeeded();
    const next = await updateSettings({ monthlyIncome: val });
    onSettingsChange(next);
    showToast(
      val > 0
        ? "Income tracking is on."
        : "Income tracking is off — dashboard shows budget only.",
    );
  }

  // Data management
  async function doExportJSON() {
    downloadFile(
      `pfos-backup-${todayISO()}.json`,
      await exportFullBackup(),
      "application/json",
    );
  }
  async function doExportCSV() {
    downloadFile(
      `pfos-transactions-${todayISO()}.csv`,
      await exportTransactionsCSV(),
      "text/csv",
    );
  }
  async function doExportCategoriesCSV() {
    downloadFile(
      `pfos-categories-${todayISO()}.csv`,
      await exportCategoriesCSV(),
      "text/csv",
    );
  }
  async function doExportMonthlySummaryCSV() {
    downloadFile(
      `pfos-monthly-summary-${todayISO()}.csv`,
      await exportMonthlySummaryCSV(),
      "text/csv",
    );
  }
  async function doExportMLDataset() {
    downloadFile(
      `pfos-ml-dataset-${todayISO()}.json`,
      await exportMLDatasetJSON(),
      "application/json",
    );
  }
  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      await importFullBackup(text);
      showToast("Backup restored.");
      const s = await updateSettings({});
      onSettingsChange(s);
    } catch {
      showToast("That file doesn't look like a valid backup.");
    }
    e.target.value = "";
  }
  async function wipeAll() {
    if (
      !confirm(
        "This deletes every category, transaction, and recurring item on this device. This can't be undone. Continue?",
      )
    )
      return;
    await db.transaction(
      "rw",
      db.categories,
      db.transactions,
      db.recurring,
      db.settings,
      async () => {
        await db.categories.clear();
        await db.transactions.clear();
        await db.recurring.clear();
        await db.settings.clear();
      },
    );
    location.reload();
  }

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Settings</div>
        <h1>Preferences &amp; data</h1>
      </header>
      <div className="content">
        <div className="card">
          <h2>Categories &amp; budgets</h2>
          {draftCats.map((c, i) => (
            <div className="cat-edit-row" key={c.id ?? "new-" + i}>
              <IconPicker
                icon={c.icon}
                color={c.color}
                palette={PALETTE}
                onIconChange={(icon) => updateCat(i, "icon", icon)}
                onColorChange={(color) => updateCat(i, "color", color)}
              />
              <input
                type="text"
                placeholder="Category"
                value={c.name}
                onChange={(e) => updateCat(i, "name", e.target.value)}
              />
              <input
                type="number"
                placeholder="Budget"
                value={c.budget}
                onChange={(e) => updateCat(i, "budget", e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
              />
              <button
                className="icon-btn danger"
                aria-label="Remove"
                onClick={() => removeCat(i)}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <button className="btn secondary" onClick={addCat}>
            + Add category
          </button>
          <button className="btn" onClick={saveCats}>
            Save changes
          </button>
        </div>

        <div className="card">
          <h2>Income sources</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Separate from your spending categories above — no budget applies
            here, these just label where money comes from (salary, freelance
            work, etc.) when you log it as income.
          </p>
          {draftIncomeCats.length === 0 && (
            <p className="muted" style={{ marginBottom: 12 }}>
              None yet. Add one below, or set a monthly income in Preferences to
              add the common ones automatically.
            </p>
          )}
          {draftIncomeCats.map((c, i) => (
            <div className="cat-edit-row" key={c.id ?? "new-income-" + i}>
              <IconPicker
                icon={c.icon}
                color={c.color}
                palette={PALETTE}
                onIconChange={(icon) => updateIncomeCat(i, "icon", icon)}
                onColorChange={(color) => updateIncomeCat(i, "color", color)}
              />
              <input
                type="text"
                placeholder="Source (e.g. Salary)"
                value={c.name}
                onChange={(e) => updateIncomeCat(i, "name", e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="icon-btn danger"
                aria-label="Remove"
                onClick={() => removeIncomeCat(i)}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <button className="btn secondary" onClick={addIncomeCat}>
            + Add income source
          </button>
          <button className="btn" onClick={saveIncomeCats}>
            Save changes
          </button>
        </div>

        <div className="card">
          <h2>Recurring transactions</h2>
          {recurring.length === 0 ? (
            <div className="muted" style={{ marginBottom: 12 }}>
              None yet — rent, subscriptions, salary, EMIs all post
              automatically once added.
            </div>
          ) : (
            recurring.map((r) => {
              const c = categories.find((cat) => cat.id === r.categoryId);
              return (
                <div className="tx" key={r.id}>
                  <div className="tx-left">
                    <div
                      className="tx-icon"
                      style={{
                        background: (c?.color || "#888") + "26",
                        color: c?.color,
                      }}
                    >
                      {c?.icon || "＊"}
                    </div>
                    <div className="tx-meta">
                      <div className="tx-cat">{r.name}</div>
                      <div className="tx-note">
                        {r.frequency} · next {r.nextDate}
                        {r.paused ? " · paused" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="tx-right">
                    <button
                      className="btn small secondary"
                      onClick={() => togglePause(r)}
                    >
                      {r.paused ? "Resume" : "Pause"}
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => deleteRecurring(r.id!)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
          <label>Name</label>
          <input
            type="text"
            placeholder="e.g. Rent, Netflix, Salary"
            value={rName}
            onChange={(e) => setRName(e.target.value)}
          />
          <div className="row2">
            <div>
              <label>Amount</label>
              <input
                type="number"
                value={rAmount}
                onChange={(e) => setRAmount(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
              />
            </div>
            <div>
              <label>Frequency</label>
              <Dropdown
                value={rFreq}
                onChange={(v) => setRFreq(v as Frequency)}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                  { value: "yearly", label: "Yearly" },
                ]}
              />
            </div>
          </div>
          <div className="row2">
            <div>
              <label>Category</label>
              <Dropdown
                value={rCat != null ? String(rCat) : ""}
                onChange={(v) => setRCat(Number(v))}
                placeholder="Select…"
                options={categories.map((c) => ({
                  value: String(c.id),
                  label: `${c.icon} ${c.name}`,
                }))}
              />
            </div>
            <div>
              <label>Type</label>
              <Dropdown
                value={rType}
                onChange={(v) => setRType(v as "expense" | "income")}
                options={[
                  { value: "expense", label: "Expense" },
                  { value: "income", label: "Income" },
                ]}
              />
            </div>
          </div>
          <button className="btn secondary" onClick={addRecurring}>
            + Add recurring item
          </button>
        </div>

        <div className="card">
          <h2>Preferences</h2>
          <label>Currency</label>
          <div className="chip-row">
            {["₹", "$", "€", "£"].map((c) => (
              <button
                key={c}
                className={"chip" + (settings.currency === c ? " active" : "")}
                onClick={() => setCurrency(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <label>Theme</label>
          <div className="chip-row">
            {(["dark", "light", "system"] as const).map((t) => (
              <button
                key={t}
                className={"chip" + (settings.theme === t ? " active" : "")}
                onClick={() => setTheme(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <label htmlFor="monthly-income">Monthly income</label>
          <input
            id="monthly-income"
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            value={incomeDraft}
            onChange={(e) => setIncomeDraft(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
          />
          <p className="muted" style={{ marginTop: 8 }}>
            {Number(incomeDraft) > 0
              ? "The dashboard tracks income vs. spend and shows savings. Your fixed income counts automatically each month — you don\u2019t need to log it as a transaction."
              : "Left at 0, the dashboard shows only your category budgets — no income or savings tracking. Set an amount if you want savings tracked alongside your spending."}
          </p>
          <button className="btn secondary" onClick={saveIncome}>
            Save income
          </button>
        </div>

        <div className="card">
          <h2>Your data</h2>
          <p className="muted">
            Stored only in this browser, on this device. Nothing is ever sent to
            a server — export a backup regularly so you don't lose history if
            you clear browser data or switch devices.
          </p>
          <button className="btn secondary" onClick={doExportJSON}>
            Export backup (.json)
          </button>
          <label htmlFor="import-file">Restore from backup</label>
          <input
            id="import-file"
            type="file"
            accept="application/json"
            onChange={onImport}
          />
          <button className="btn danger" onClick={wipeAll}>
            Erase all data
          </button>
        </div>

        <div className="card">
          <h2>Analysis exports</h2>
          <p className="muted">
            Built for Power BI, Excel, or a Python/pandas notebook — every
            export is a clean flat table with precomputed date fields (weekday,
            week, quarter, year), so no reshaping is needed before you build a
            report or train a model.
          </p>
          <button className="btn secondary" onClick={doExportCSV}>
            Transactions (.csv — fact table)
          </button>
          <button className="btn secondary" onClick={doExportCategoriesCSV}>
            Categories (.csv — dimension table)
          </button>
          <button className="btn secondary" onClick={doExportMonthlySummaryCSV}>
            Monthly budget vs. actual (.csv)
          </button>
          <button className="btn secondary" onClick={doExportMLDataset}>
            Full ML dataset (.json — all tables bundled)
          </button>
          <p className="muted" style={{ marginTop: 12 }}>
            In Power BI: Get Data → Text/CSV for each file, then relate
            Transactions to Categories on <code>CategoryId</code>. See{" "}
            <code>DATA_SCHEMA.md</code> in the project source for full field
            definitions.
          </p>
        </div>

        <div className="card">
          <h2>About</h2>
          <p className="muted">
            Personal Finance OS — zero login, zero ads, zero subscription, zero
            analytics, zero tracking. Installable to your home screen and fully
            usable offline.
          </p>
        </div>
      </div>
    </>
  );
}
