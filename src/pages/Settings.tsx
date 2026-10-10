import { useState } from "react";
import { EMPTY_LIST } from "../lib/stable";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import {
  db,
  type Category,
  type Bracket,
  type BracketKind,
  type Recurring,
  type Frequency,
  updateSettings,
  type Settings as SettingsType,
  ensureIncomeCategoriesSeeded,
} from "../db/db";
import { X, ChevronRight, Plus } from "lucide-react";
import Dropdown from "../components/Dropdown";
import {
  exportFullBackup,
  exportTransactionsCSV,
  exportCategoriesCSV,
  exportBracketsCSV,
  exportMonthlySummaryCSV,
  exportMLDatasetJSON,
  importFullBackup,
  downloadFile,
} from "../lib/csv";
import { todayISO, iconBadgeStyle, roundMoney } from "../lib/format";
import { useUIStore } from "../store/useUIStore";
import { clearWidget } from "../lib/widgetSync";
import { describeBackupAge } from "../lib/backupNudge";
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
const KIND_LABEL: Record<BracketKind, string> = {
  spend: "Budget cap",
  allocation: "Allocation",
  income: "Income",
};

export default function Settings({
  settings,
  onSettingsChange,
}: {
  settings: SettingsType;
  onSettingsChange: (s: SettingsType) => void;
}) {
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? EMPTY_LIST;
  const brackets = useLiveQuery(() => db.brackets.toArray(), []) ?? EMPTY_LIST;
  const recurring = useLiveQuery(() => db.recurring.toArray(), []) ?? EMPTY_LIST;
  const bracketById = new Map(brackets.map((b) => [b.id, b]));
  const activeBrackets = brackets.filter((b) => !b.archived);
  const archivedBrackets = brackets.filter((b) => b.archived);
  const archivedCategories = categories.filter((c) => c.archived);
  const categoryCountByBracket = new Map<number, number>();
  for (const c of categories) {
    if (c.archived) continue;
    categoryCountByBracket.set(
      c.bracketId,
      (categoryCountByBracket.get(c.bracketId) ?? 0) + 1,
    );
  }

  // Adding a bracket is the only thing Settings does directly — everything
  // else (adding/editing categories within a bracket, renaming a bracket)
  // happens on that bracket's own page, reached by tapping its row below.
  // One reusable page instead of duplicating category-editing UI per kind.
  const [showAddBracket, setShowAddBracket] = useState(false);
  const [newBracketName, setNewBracketName] = useState("");
  const [newBracketIcon, setNewBracketIcon] = useState("＊");
  const [newBracketColor, setNewBracketColor] = useState(PALETTE[0]);
  const [newBracketKind, setNewBracketKind] = useState<BracketKind>("spend");

  async function addBracket() {
    if (!newBracketName.trim()) {
      showToast("Give the bracket a name.");
      return;
    }
    const id = await db.brackets.add({
      name: newBracketName.trim(),
      icon: newBracketIcon,
      color: newBracketColor,
      kind: newBracketKind,
    });
    setNewBracketName("");
    setNewBracketIcon("＊");
    setNewBracketColor(PALETTE[0]);
    setNewBracketKind("spend");
    setShowAddBracket(false);
    showToast(`"${newBracketName.trim()}" bracket added.`);
    navigate("/bracket/" + id);
  }

  // Deleting a category outright silently orphans any transaction that
  // pointed at it — they'd just fall back to showing as "Uncategorized"
  // everywhere with no warning, and quietly drop out of that category's
  // historical totals in Analytics. Archiving is offered as the default
  // path instead when a category has real history. (Live on BracketDetail
  // for active categories; this is only reached for the Archived list here.)
  async function restoreCategory(cat: Category) {
    if (!cat.id) return;
    await db.categories.update(cat.id, { archived: false });
    showToast(`Restored "${cat.name}".`);
  }

  async function restoreBracket(bracket: Bracket) {
    if (!bracket.id) return;
    await db.brackets.update(bracket.id, { archived: false });
    showToast(`Restored "${bracket.name}".`);
  }

  // Recurring
  const [rName, setRName] = useState("");
  const [rAmount, setRAmount] = useState("");
  const [rCat, setRCat] = useState<number | null>(null);
  const [rFreq, setRFreq] = useState<Frequency>("monthly");
  const [rType, setRType] = useState<"expense" | "income">("expense");

  async function addRecurring() {
    const amt = roundMoney(parseFloat(rAmount));
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
  async function setHideWidgetAmounts(hide: boolean) {
    const next = await updateSettings({ hideWidgetAmounts: hide });
    onSettingsChange(next);
  }
  async function saveIncome() {
    const val = roundMoney(parseFloat(incomeDraft) || 0);
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
    await tryExport(async () => {
      await downloadFile(
        `moneymate-backup-${todayISO()}.json`,
        await exportFullBackup(),
        "application/json",
      );
      // Only reached if the file was actually handed off (downloadFile throws
      // when the export or share fails), so "last backup" isn't set early.
      const next = await updateSettings({
        lastBackupAt: Date.now(),
        backupNudgeSnoozedUntil: 0,
      });
      onSettingsChange(next);
    });
  }
  async function doExportCSV() {
    await tryExport(async () =>
      downloadFile(
        `moneymate-transactions-${todayISO()}.csv`,
        await exportTransactionsCSV(),
        "text/csv",
      ),
    );
  }
  async function doExportCategoriesCSV() {
    await tryExport(async () =>
      downloadFile(
        `moneymate-categories-${todayISO()}.csv`,
        await exportCategoriesCSV(),
        "text/csv",
      ),
    );
  }
  async function doExportBracketsCSV() {
    await tryExport(async () =>
      downloadFile(
        `moneymate-brackets-${todayISO()}.csv`,
        await exportBracketsCSV(),
        "text/csv",
      ),
    );
  }
  async function doExportMonthlySummaryCSV() {
    await tryExport(async () =>
      downloadFile(
        `moneymate-monthly-summary-${todayISO()}.csv`,
        await exportMonthlySummaryCSV(),
        "text/csv",
      ),
    );
  }
  async function doExportMLDataset() {
    await tryExport(async () =>
      downloadFile(
        `moneymate-ml-dataset-${todayISO()}.json`,
        await exportMLDatasetJSON(),
        "application/json",
      ),
    );
  }
  // Shares the try/catch + toast for every export button — on native Android
  // this now goes through the Filesystem/Share plugins (see downloadFile),
  // which can fail (e.g. the user backs out of the share sheet, or the
  // device is out of storage) in ways a plain browser download never did.
  async function tryExport(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch {
      showToast("Couldn't export that file. Please try again.");
    }
  }
  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const confirmed = await showConfirm({
      title: "Restore backup?",
      message: "This replaces every category, transaction, and recurring item currently on this device. This can't be undone.",
      confirmLabel: "Restore",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!confirmed) {
      e.target.value = "";
      return;
    }
    try {
      const text = await file.text();
      await importFullBackup(text);
      showToast("Backup restored.");
      const s = await updateSettings({});
      onSettingsChange(s);
    } catch (err) {
      showToast(
        err instanceof Error && err.message
          ? err.message
          : "That file doesn't look like a valid backup.",
      );
    }
    e.target.value = "";
  }
  async function wipeAll() {
    const confirmed = await showConfirm({
      title: "Erase all data?",
      message: "This deletes every category, transaction, and recurring item on this device. This can't be undone.",
      confirmLabel: "Erase everything",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!confirmed)
      return;
    try {
      await db.transaction(
        "rw",
        [
          db.brackets,
          db.categories,
          db.transactions,
          db.recurring,
          db.settings,
          db.splitShares,
          db.budgetHistory,
        ],
        async () => {
          await db.splitShares.clear();
          await db.budgetHistory.clear();
          await db.brackets.clear();
          await db.categories.clear();
          await db.transactions.clear();
          await db.recurring.clear();
          await db.settings.clear();
        },
      );
    } catch (err) {
      console.warn("Erase all data failed", err);
      showToast("Couldn't erase your data. Nothing was changed.");
      return;
    }
    // The home-screen widget keeps its own copy of the totals and category
    // names in native storage — blank it too, or erased data stays visible.
    await clearWidget();
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
          <h2>Brackets</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Expenditure, Savings, Investments, Income, or your own. Tap one to
            manage its categories — sub-dividing is optional.
          </p>
          {activeBrackets.length === 0 ? (
            <p className="muted" style={{ marginBottom: 12 }}>
              None yet. Add one below.
            </p>
          ) : (
            activeBrackets.map((b) => (
              <div
                key={b.id}
                className="tx tx-link"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                }}
                onClick={() => navigate("/bracket/" + b.id)}
              >
                <div className="tx-left">
                  <div className="tx-icon" style={iconBadgeStyle(b.color)}>
                    {b.icon}
                  </div>
                  <div className="tx-meta">
                    <div className="tx-cat">{b.name}</div>
                    <div className="tx-note">
                      {KIND_LABEL[b.kind]} ·{" "}
                      {categoryCountByBracket.get(b.id!) ?? 0} categor
                      {(categoryCountByBracket.get(b.id!) ?? 0) === 1
                        ? "y"
                        : "ies"}
                    </div>
                  </div>
                </div>
                <ChevronRight
                  size={18}
                  style={{ color: "var(--ink-faint)", flexShrink: 0 }}
                />
              </div>
            ))
          )}

          {showAddBracket ? (
            <div style={{ marginTop: 12 }}>
              <div className="cat-edit-row" style={{ borderBottom: "none" }}>
                <IconPicker
                  icon={newBracketIcon}
                  color={newBracketColor}
                  palette={PALETTE}
                  onIconChange={setNewBracketIcon}
                  onColorChange={setNewBracketColor}
                />
                <input
                  type="text"
                  placeholder="Bracket name (e.g. EMI)"
                  value={newBracketName}
                  onChange={(e) => setNewBracketName(e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
              <label>Behaves like</label>
              <div className="chip-row">
                <button
                  className={
                    "chip" + (newBracketKind === "spend" ? " active" : "")
                  }
                  onClick={() => setNewBracketKind("spend")}
                >
                  Budget cap
                </button>
                <button
                  className={
                    "chip" + (newBracketKind === "allocation" ? " active" : "")
                  }
                  onClick={() => setNewBracketKind("allocation")}
                >
                  Allocation
                </button>
                <button
                  className={
                    "chip" + (newBracketKind === "income" ? " active" : "")
                  }
                  onClick={() => setNewBracketKind("income")}
                >
                  Income
                </button>
              </div>
              <button className="btn" onClick={addBracket}>
                Create bracket
              </button>
              <button
                className="btn ghost"
                onClick={() => setShowAddBracket(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="btn secondary"
              onClick={() => setShowAddBracket(true)}
              style={{ marginTop: 8 }}
            >
              <Plus size={15} style={{ verticalAlign: -2, marginRight: 4 }} />
              Add bracket
            </button>
          )}
        </div>

        {archivedBrackets.length > 0 && (
          <div className="card">
            <h2>Archived brackets</h2>
            <p className="muted" style={{ marginBottom: 12 }}>
              Hidden everywhere, but untouched. Restore anytime.
            </p>
            {archivedBrackets.map((b) => (
              <div
                key={b.id}
                className="tx tx-link"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>
                  {b.icon} {b.name}
                </span>
                <button
                  className="btn small secondary"
                  onClick={() => restoreBracket(b)}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}

        {archivedCategories.length > 0 && (
          <div className="card">
            <h2>Archived categories</h2>
            <p className="muted" style={{ marginBottom: 12 }}>
              Hidden from new transactions; history stays intact.
            </p>
            {archivedCategories.map((c) => (
              <div className="tx" key={c.id}>
                <div className="tx-left">
                  <div className="tx-icon" style={iconBadgeStyle(c.color)}>
                    {c.icon}
                  </div>
                  <div className="tx-meta">
                    <div className="tx-cat">{c.name}</div>
                    <div className="tx-note">
                      {(() => {
                        const kind = bracketById.get(c.bracketId)?.kind;
                        return kind ? KIND_LABEL[kind] : "Category";
                      })()}
                    </div>
                  </div>
                </div>
                <div className="tx-right">
                  <button
                    className="btn small secondary"
                    onClick={() => restoreCategory(c)}
                  >
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

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
                    <div className="tx-icon" style={iconBadgeStyle(c?.color)}>
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
          <label htmlFor="recurring-name">Name</label>
          <input
            id="recurring-name"
            type="text"
            placeholder="e.g. Rent, Netflix, Salary"
            value={rName}
            onChange={(e) => setRName(e.target.value)}
          />
          <div className="row2">
            <div>
              <label htmlFor="recurring-amount">Amount</label>
              <input
                id="recurring-amount"
                type="number"
                placeholder="0.00"
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
                options={categories
                  .filter(
                    (c) =>
                      !c.archived && !bracketById.get(c.bracketId)?.archived,
                  )
                  .map((c) => {
                    const bracket = bracketById.get(c.bracketId);
                    return {
                      value: String(c.id),
                      label: `${c.icon} ${c.name}${bracket ? ` · ${bracket.name}` : ""}`,
                    };
                  })}
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
          <label>Home-screen widget</label>
          <div className="chip-row">
            <button
              className={
                "chip" + (!settings.hideWidgetAmounts ? " active" : "")
              }
              onClick={() => setHideWidgetAmounts(false)}
            >
              Show amounts
            </button>
            <button
              className={"chip" + (settings.hideWidgetAmounts ? " active" : "")}
              onClick={() => setHideWidgetAmounts(true)}
            >
              Hide amounts
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {settings.hideWidgetAmounts
              ? "The widget shows a masked progress bar only — no figures — since it\u2019s visible on your home screen (and lock screen, if placed there) to anyone nearby."
              : "The widget shows your remaining budget and spend at a glance. Turn this off if you\u2019d rather not have those figures visible on your home screen."}
          </p>
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
              ? "Home shows this against your spending, allocations, and what\u2019s left unallocated. Your fixed income counts automatically each month — you don\u2019t need to log it as a transaction."
              : "Left at 0, Home simplifies down to just your Budget total — no income or allocation tracking. Set an amount if you want the fuller picture on Home."}
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
          <p className="muted" role="status">
            Last backup:{" "}
            <b>{describeBackupAge(settings.lastBackupAt, Date.now())}</b>
          </p>
          <button className="btn secondary" onClick={doExportJSON}>
            Export backup (.json)
          </button>
          <label htmlFor="import-file" className="btn secondary">
            Restore from backup
          </label>
          <input
            id="import-file"
            type="file"
            className="sr-only"
            accept="application/json"
            onChange={onImport}
          />

          <div className="danger-zone">
            <div className="danger-zone-label">Erase everything</div>
            <button className="btn danger" onClick={wipeAll}>
              Erase all data
            </button>
          </div>
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
          <button className="btn secondary" onClick={doExportBracketsCSV}>
            Brackets (.csv — dimension table)
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
            Money Mate — zero login, zero ads, zero subscription, zero tracking.
            Installable to your home screen and fully usable offline.
          </p>
        </div>
      </div>
    </>
  );
}
