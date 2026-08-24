import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { db, type Category } from "../db/db";
import { fmtMoney, monthKey, monthLabel, todayISO } from "../lib/format";
import { computeCatchAllAdjustment, progressState } from "../lib/budgetLogic";
import Ring from "../components/Ring";
import IconPicker from "../components/IconPicker";
import CategoryRow from "../components/CategoryRow";
import { X, Wallet, Pencil, Archive, Trash2, Check } from "lucide-react";
import { useUIStore } from "../store/useUIStore";

const PALETTE = ["#F0B94D", "#4FD9B8", "#7C93F0", "#E8618C", "#B98CF0", "#F0A83E", "#FF6B6B", "#6FC98A"];


/**
 * The single drill-down page for any bracket — Expenditure, Savings,
 * Investments, Income, or a custom one. Reached from a Home card (to see
 * this month's progress) or from Settings (to manage its categories) — same
 * page either way, since for a private single-user app there's no real
 * benefit to splitting "view" and "edit" into two screens that would need
 * to be kept in sync with each other.
 *
 * A bracket's own total is always the sum of its categories' budgets, so a
 * bracket with one category and a bracket with ten render through exactly
 * the same code path — "should this bracket show a drill-down list" is
 * never a special case, it's just how many rows the list below has.
 */
export default function BracketDetail({
  currency,
  monthlyIncome,
}: {
  currency: string;
  monthlyIncome: number;
}) {
  const navigate = useNavigate();
  const { id } = useParams();
  const bracketId = Number(id);
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);
  const curMonth = monthKey(todayISO());

  const bracket = useLiveQuery(() => db.brackets.get(bracketId), [bracketId]);
  const categories = useLiveQuery(
    () => db.categories.where("bracketId").equals(bracketId).toArray(),
    [bracketId],
  ) ?? [];
  const activeCategories = categories.filter((c) => !c.archived);
  const archivedCategories = categories.filter((c) => c.archived);
  const categoryIds = new Set(activeCategories.map((c) => c.id));

  const txs = useLiveQuery(() => db.transactions.toArray(), []) ?? [];
  const monthTx = txs.filter((t) => monthKey(t.date) === curMonth);
  // The Income bracket's categories are logged as type 'income'; every
  // other bracket's categories are logged as type 'expense' — so which
  // transaction type counts toward "this month" per category depends on
  // the bracket's kind, not a fixed assumption.
  const relevantTxType = bracket?.kind === "income" ? "income" : "expense";
  const spentByCategory = new Map<number, number>();
  for (const t of monthTx) {
    if (t.type !== relevantTxType || !categoryIds.has(t.categoryId)) continue;
    spentByCategory.set(t.categoryId, (spentByCategory.get(t.categoryId) ?? 0) + t.amount);
  }
  const totalTarget = activeCategories.reduce((s, c) => s + c.budget, 0);
  const totalSpent = [...spentByCategory.values()].reduce((s, v) => s + v, 0);
  const left = totalTarget - totalSpent;

  // The ring's percentage always means "spent/logged as a share of target",
  // but what crossing 100% *means* flips by bracket kind: for a spend cap,
  // going over is the bad outcome (overspent) and gets the red "over"
  // treatment. For an allocation target (Savings/Investments), going over
  // means the target was met or exceeded — a good outcome, not a warning —
  // so it's clamped to the same "good" state as being comfortably under,
  // rather than reusing spend's over-budget red for what's actually a win.
  const ringPctRaw = totalTarget > 0 ? (totalSpent / totalTarget) * 100 : 0;
  const ringPct = Math.min(ringPctRaw, 100);
  const ringState = progressState(ringPctRaw, bracket?.kind === "allocation");
  const ringColor = `var(--${ringState === "warn" ? "gold" : ringState})`;

  // For the Income bracket specifically: fixed monthly income (Settings)
  // counts automatically and isn't a transaction; totalSpent here is
  // actually "logged income" since relevantTxType is 'income' for this
  // bracket. Both count toward "this month".
  const loggedIncome = totalSpent;
  const totalIncomeThisMonth = monthlyIncome + loggedIncome;

  const [draftCats, setDraftCats] = useState<Category[]>([]);
  const [editingCats, setEditingCats] = useState(false);
  useEffect(() => {
    setDraftCats(activeCategories);
    // Deliberately keyed on the categories' actual field values (not just
    // which ids exist) — a save that only changes an existing category's
    // budget (e.g. General shrinking after adding Food) doesn't add or
    // remove any id, so an id-only dependency would never notice the DB
    // actually changed underneath. Without this, the form and the live
    // preview banner kept showing what was last typed instead of the
    // freshly-saved truth, until something else (like navigating away and
    // back) forced a full remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracketId, JSON.stringify(activeCategories.map((c) => [c.id, c.name, c.budget, c.icon, c.color]))]);

  useEffect(() => {
    setEditingCats(false);
  }, [bracketId]);

  const [bracketName, setBracketName] = useState("");
  const [bracketIcon, setBracketIcon] = useState("");
  const [bracketColor, setBracketColor] = useState("");
  useEffect(() => {
    if (!bracket) return;
    setBracketName(bracket.name);
    setBracketIcon(bracket.icon);
    setBracketColor(bracket.color);
  }, [bracket]);

  function updateCat(i: number, field: keyof Category, val: string | number) {
    setDraftCats((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  }
  function addCat() {
    setDraftCats((prev) => [
      ...prev,
      { name: "", icon: bracket?.icon ?? "＊", color: PALETTE[prev.length % PALETTE.length], budget: 0, bracketId },
    ]);
  }
  async function removeCat(i: number) {
    const cat = draftCats[i];
    if (!cat.id) {
      setDraftCats((prev) => prev.filter((_, idx) => idx !== i));
      return;
    }
    const count = await db.transactions.where("categoryId").equals(cat.id).count();
    if (count > 0) {
      const wantsDelete = await showConfirm({
        title: `Delete "${cat.name || "this category"}"?`,
        message: `It has ${count} transaction${count === 1 ? "" : "s"} — deleting it permanently marks ${count === 1 ? "that one" : "those"} "Uncategorized".\n\nAlternatively, cancel to archive instead (keeps your history, just hides it from new transactions).`,
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!wantsDelete) {
        const wantsArchive = await showConfirm({
          title: `Archive "${cat.name || "this category"}"?`,
          message: "You can restore it later from Settings.",
          confirmLabel: "Archive",
          cancelLabel: "Cancel",
        });
        if (!wantsArchive) return;
        await db.categories.update(cat.id, { archived: true });
        showToast(`Archived "${cat.name || "category"}".`);
        setDraftCats((prev) => prev.filter((_, idx) => idx !== i));
        return;
      }
    }
    await db.categories.delete(cat.id);
    showToast(count > 0 ? `Deleted — its ${count} transaction${count === 1 ? "" : "s"} are now Uncategorized.` : "Deleted.");
    setDraftCats((prev) => prev.filter((_, idx) => idx !== i));
  }
  async function restoreCat(cat: Category) {
    if (!cat.id) return;
    await db.categories.update(cat.id, { archived: false });
    showToast(`Restored "${cat.name}".`);
  }
  async function saveCats() {
    if (!bracket) return;
    const adjustment = computeCatchAllAdjustment(activeCategories, draftCats, bracket.name);
    const toSave = adjustment
      ? draftCats.map((c) => (c.id === adjustment.catchAllId ? { ...c, budget: adjustment.newBudget } : c))
      : draftCats;

    for (const c of toSave) {
      if (!c.name.trim()) continue;
      const payload = { name: c.name.trim(), budget: Number(c.budget) || 0, icon: c.icon, color: c.color, bracketId };
      if (c.id) await db.categories.update(c.id, payload);
      else await db.categories.add(payload);
    }

    // The catch-all category fully absorbed into real categories now —
    // archive the dead 0-budget row rather than leaving it cluttering the
    // list. Restorable from Settings later if a fresh catch-all is ever
    // wanted again.
    if (adjustment && adjustment.newBudget === 0) {
      await db.categories.update(adjustment.catchAllId, { archived: true });
    }

    let message = "Saved.";
    if (adjustment) {
      const shortfall = Math.max(0, adjustment.newlyAddedBudget - adjustment.oldBudget);
      const covered = adjustment.newlyAddedBudget - shortfall;
      const name = adjustment.catchAllName;
      if (shortfall === 0) {
        message =
          adjustment.newBudget === 0
            ? `Saved — ${name} is now empty and archived.`
            : `Saved — ${name} shrank by ${fmtMoney(covered, currency)}.`;
      } else {
        // The catch-all didn't have enough left to absorb all of it — it's
        // now archived (drained to 0) and the rest genuinely raised the total.
        message = `Saved — ${name} covered ${fmtMoney(covered, currency)}; total grew by ${fmtMoney(shortfall, currency)}.`;
      }
    }
    showToast(message);
  }
  async function saveBracket() {
    if (!bracket?.id || !bracketName.trim()) return;
    await db.brackets.update(bracket.id, { name: bracketName.trim(), icon: bracketIcon, color: bracketColor });
    showToast("Bracket updated.");
  }

  async function archiveBracket() {
    if (!bracket?.id) return;
    await db.brackets.update(bracket.id, { archived: true });
    showToast(`Archived "${bracket.name}". Restore anytime from Settings.`);
    navigate("/settings");
  }

  // Deleting a bracket outright cascades to every category inside it (same
  // as deleting a lone category would) — any transaction that pointed at
  // one of those categories falls back to showing as "Uncategorized"
  // everywhere. Archiving is offered as the default path whenever the
  // bracket actually has categories in it, exactly like category deletion.
  async function deleteBracket() {
    if (!bracket?.id) return;
    const allCats = await db.categories.where("bracketId").equals(bracket.id).toArray();
    const catIds = allCats.map((c) => c.id!).filter((id): id is number => id != null);
    const txCount = catIds.length ? await db.transactions.where("categoryId").anyOf(catIds).count() : 0;

    if (allCats.length > 0) {
      const wantsDelete = await showConfirm({
        title: `Delete "${bracket.name}"?`,
        message:
          `It has ${allCats.length} categor${allCats.length === 1 ? "y" : "ies"}` +
          (txCount > 0 ? ` and ${txCount} transaction${txCount === 1 ? "" : "s"}` : "") +
          `. Deleting removes the bracket and everything inside it` +
          (txCount > 0 ? `; those transactions become "Uncategorized".` : "."),
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!wantsDelete) return;
    } else {
      const confirmed = await showConfirm({
        title: `Delete "${bracket.name}"?`,
        message: "This empty bracket will be permanently removed.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!confirmed) return;
    }

    await db.transaction("rw", db.brackets, db.categories, async () => {
      if (catIds.length) await db.categories.bulkDelete(catIds);
      await db.brackets.delete(bracket.id!);
    });
    showToast(
      txCount > 0
        ? `Deleted "${bracket.name}" — its transactions are now Uncategorized.`
        : `Deleted "${bracket.name}".`,
    );
    navigate("/settings");
  }

  if (!bracket) {
    return (
      <>
        <header className="topbar">
          <div className="eyebrow">Money Mate</div>
          <h1>Loading…</h1>
        </header>
      </>
    );
  }

  const amountLabel = bracket.kind === "spend" ? "Budget" : bracket.kind === "allocation" ? "Target" : "Fixed amount";

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Money Mate</div>
        <h1>{bracket.icon} {bracket.name}</h1>
        <div className="sub">{monthLabel(curMonth)}</div>
      </header>
      <div className="content">
        {bracket.kind !== "income" && totalTarget > 0 && (
          <div className="card bracket-hero">
            <div className="ring-wrap">
              <Ring pct={ringPct} color={ringState} size={96} />
              <div className="ring-figs">
                <div className="big" style={{ color: ringColor }}>
                  {ringPctRaw.toFixed(0)}%
                </div>
                <div className="lbl">
                  {bracket.kind === "spend"
                    ? `of ${fmtMoney(totalTarget, currency)} budget used`
                    : ringPctRaw >= 100
                      ? `target met — ${fmtMoney(totalSpent, currency)} of ${fmtMoney(totalTarget, currency)}`
                      : `of ${fmtMoney(totalTarget, currency)} target reached`}
                </div>
              </div>
            </div>
            <div className="bracket-hero-fig">
              {bracket.kind === "spend" ? (
                <>
                  <span style={{ color: left < 0 ? "var(--over)" : "var(--good)" }}>
                    {fmtMoney(Math.abs(left), currency)}
                  </span>{" "}
                  {left < 0 ? "over budget" : "left this month"}
                </>
              ) : (
                <>
                  <span style={{ color: left < 0 ? "var(--good)" : "var(--ink)" }}>
                    {fmtMoney(Math.abs(left), currency)}
                  </span>{" "}
                  {left < 0 ? "over target — nice work" : "still to go"}
                </>
              )}
            </div>
          </div>
        )}
        {bracket.kind === "income" ? (
          <div className="grid-3">
            <div>
              <div className="label">This month</div>
              <div className="value">{fmtMoney(totalIncomeThisMonth, currency)}</div>
            </div>
            <div>
              <div className="label">Fixed</div>
              <div className="value">{fmtMoney(monthlyIncome, currency)}</div>
            </div>
            <div>
              <div className="label">Logged</div>
              <div className="value">{fmtMoney(loggedIncome, currency)}</div>
            </div>
          </div>
        ) : (
          <div className="grid-3">
            <div>
              <div className="label">{bracket.kind === "spend" ? "Budgeted" : "Target"}</div>
              <div className="value">{fmtMoney(totalTarget, currency)}</div>
            </div>
            <div>
              <div className="label">Spent</div>
              <div className="value">{fmtMoney(totalSpent, currency)}</div>
            </div>
            <div className={left < 0 ? "neg" : "pos"}>
              <div className="label">{bracket.kind === "spend" ? "Remaining" : "Left"}</div>
              <div className="value">{fmtMoney(left, currency)}</div>
            </div>
          </div>
        )}

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: activeCategories.length === 0 ? 0 : 4 }}>
            <h2 style={{ margin: 0 }}>Categories</h2>
            {activeCategories.length > 0 && (
              <button
                className="icon-btn"
                aria-label={editingCats ? "Done editing categories" : "Edit categories"}
                onClick={() => {
                  if (editingCats) saveCats();
                  setEditingCats((v) => !v);
                }}
              >
                {editingCats ? <Check size={16} /> : <Pencil size={15} />}
              </button>
            )}
          </div>

          {activeCategories.length === 0 && !editingCats && (
            <div className="empty">
              <div className="glyph">
                <Wallet size={30} strokeWidth={1.5} />
              </div>
              No categories yet — add one to start tracking within {bracket.name}.
              <div style={{ marginTop: 14 }}>
                <button className="btn secondary" onClick={() => setEditingCats(true)}>
                  <Pencil size={15} /> Add a category
                </button>
              </div>
            </div>
          )}

          {!editingCats &&
            activeCategories.map((c) =>
              bracket.kind === "income" ? (
                <div
                  key={c.id}
                  className="cat-row"
                  onClick={() => navigate("/history?cat=" + c.id)}
                  style={{ paddingBottom: 13 }}
                >
                  <div className="row-top" style={{ marginBottom: 0 }}>
                    <span className="name">
                      <span className="icon">{c.icon}</span>
                      {c.name}
                    </span>
                    <span className="figs">
                      <b>{fmtMoney(spentByCategory.get(c.id!) ?? 0, currency)}</b> logged
                    </span>
                  </div>
                </div>
              ) : (
                <CategoryRow
                  key={c.id}
                  category={c}
                  spent={spentByCategory.get(c.id!) ?? 0}
                  currency={currency}
                  isAllocation={bracket.kind === "allocation"}
                  onClick={() => navigate("/history?cat=" + c.id)}
                />
              ),
            )}

          {editingCats && (
            <>
              {draftCats.length === 0 && (
                <div className="empty">
                  <div className="glyph">
                    <Wallet size={30} strokeWidth={1.5} />
                  </div>
                  No categories yet — add one below to start tracking within {bracket.name}.
                </div>
              )}
              {draftCats.map((c, i) => (
                <div key={c.id ?? "new-" + i} className="cat-edit-row">
                  <IconPicker
                    icon={c.icon}
                    color={c.color}
                    palette={PALETTE}
                    onIconChange={(icon) => updateCat(i, "icon", icon)}
                    onColorChange={(color) => updateCat(i, "color", color)}
                  />
                  <input type="text" placeholder="Category" value={c.name} onChange={(e) => updateCat(i, "name", e.target.value)} />
                  {bracket.kind !== "income" && (
                    <input type="number" placeholder={amountLabel} value={c.budget} onChange={(e) => updateCat(i, "budget", e.target.value)} onWheel={(e) => e.currentTarget.blur()} />
                  )}
                  <button className="icon-btn danger" aria-label="Remove" onClick={() => removeCat(i)}><X size={15} /></button>
                </div>
              ))}
              <button className="btn secondary" onClick={addCat}>+ Add category</button>
              <button
                className="btn"
                onClick={() => {
                  saveCats();
                  setEditingCats(false);
                }}
              >
                Done
              </button>
            </>
          )}
        </div>

        {archivedCategories.length > 0 && (
          <div className="card">
            <h2>Archived</h2>
            {archivedCategories.map((c) => (
              <div key={c.id} className="tx tx-link" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{c.icon} {c.name}</span>
                <button className="btn small secondary" onClick={() => restoreCat(c)}>Restore</button>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <h2>Bracket settings</h2>
          <div className="cat-edit-row" style={{ borderBottom: "none" }}>
            <IconPicker
              icon={bracketIcon}
              color={bracketColor}
              palette={PALETTE}
              onIconChange={setBracketIcon}
              onColorChange={setBracketColor}
            />
            <input type="text" placeholder="Bracket name" value={bracketName} onChange={(e) => setBracketName(e.target.value)} style={{ flex: 1 }} />
          </div>
          <button className="btn secondary" onClick={saveBracket}>
            <Pencil size={15} /> Save bracket
          </button>

          <div className="danger-zone">
            <div className="danger-zone-label">Archive or delete this bracket</div>
            <button className="btn secondary" onClick={archiveBracket}>
              <Archive size={15} /> Archive bracket
            </button>
            <button className="btn danger" onClick={deleteBracket}>
              <Trash2 size={15} /> Delete bracket
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
