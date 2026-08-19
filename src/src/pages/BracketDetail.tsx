import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { db, type Category } from "../db/db";
import { fmtMoney, monthKey, monthLabel, todayISO } from "../lib/format";
import IconPicker from "../components/IconPicker";
import { X, Wallet } from "lucide-react";
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

  // For the Income bracket specifically: fixed monthly income (Settings)
  // counts automatically and isn't a transaction; totalSpent here is
  // actually "logged income" since relevantTxType is 'income' for this
  // bracket. Both count toward "this month".
  const loggedIncome = totalSpent;
  const totalIncomeThisMonth = monthlyIncome + loggedIncome;

  const [draftCats, setDraftCats] = useState<Category[]>([]);
  useEffect(() => {
    setDraftCats(activeCategories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bracketId, categories.length, JSON.stringify(activeCategories.map((c) => c.id))]);

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
      const wantsDelete = confirm(
        `"${cat.name || "This category"}" has ${count} transaction${count === 1 ? "" : "s"}. Deleting it permanently will show ${count === 1 ? "that one" : "those"} as "Uncategorized".\n\nPress OK to delete anyway, or Cancel to archive it instead — hides it from new transactions while keeping your existing history exactly as it is.`,
      );
      if (!wantsDelete) {
        const wantsArchive = confirm(`Archive "${cat.name || "this category"}"? You can restore it later.`);
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
    for (const c of draftCats) {
      if (!c.name.trim()) continue;
      const payload = { name: c.name.trim(), budget: Number(c.budget) || 0, icon: c.icon, color: c.color, bracketId };
      if (c.id) await db.categories.update(c.id, payload);
      else await db.categories.add(payload);
    }
    showToast("Saved.");
  }
  async function saveBracket() {
    if (!bracket?.id || !bracketName.trim()) return;
    await db.brackets.update(bracket.id, { name: bracketName.trim(), icon: bracketIcon, color: bracketColor });
    showToast("Bracket updated.");
  }

  async function archiveBracket() {
    if (!bracket?.id) return;
    await db.brackets.update(bracket.id, { archived: true });
    showToast(`Archived "${bracket.name}" — its data stays exactly as it is, restore it from Settings anytime.`);
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
      const wantsDelete = confirm(
        `"${bracket.name}" has ${allCats.length} categor${allCats.length === 1 ? "y" : "ies"}` +
          (txCount > 0 ? ` and ${txCount} transaction${txCount === 1 ? "" : "s"}` : "") +
          `. Deleting it permanently removes the bracket and every category inside it` +
          (txCount > 0 ? `; those transactions will show as "Uncategorized".` : ".") +
          `\n\nPress OK to delete everything, or Cancel to archive instead — hides it from Home and Settings while keeping all your data exactly as it is.`,
      );
      if (!wantsDelete) {
        await archiveBracket();
        return;
      }
    } else {
      if (!confirm(`Delete the empty "${bracket.name}" bracket?`)) return;
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
          <h2>Categories</h2>
          {draftCats.length === 0 && (
            <div className="empty">
              <div className="glyph">
                <Wallet size={30} strokeWidth={1.5} />
              </div>
              No categories yet — add one below to start tracking within {bracket.name}.
            </div>
          )}
          {draftCats.map((c, i) => (
            <div key={c.id ?? "new-" + i} style={{ marginBottom: 8 }}>
              <div className="cat-edit-row">
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
              {c.id != null && (
                <div
                  className="muted"
                  style={{ fontSize: 11.5, fontFamily: "var(--mono)", paddingLeft: 40, cursor: "pointer" }}
                  onClick={() => navigate("/history?cat=" + c.id)}
                >
                  {fmtMoney(spentByCategory.get(c.id) ?? 0, currency)}{" "}
                  {bracket.kind === "income" ? "logged this month" : "spent this month"}
                </div>
              )}
            </div>
          ))}
          <button className="btn secondary" onClick={addCat}>+ Add category</button>
          <button className="btn" onClick={saveCats}>Save changes</button>
        </div>

        {archivedCategories.length > 0 && (
          <div className="card">
            <h2>Archived</h2>
            {archivedCategories.map((c) => (
              <div key={c.id} className="tx-link" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
          <button className="btn secondary" onClick={saveBracket}>Save bracket</button>
          <button className="btn secondary" onClick={archiveBracket} style={{ marginTop: 8 }}>Archive bracket</button>
          <button className="btn danger" onClick={deleteBracket}>Delete bracket</button>
        </div>
      </div>
    </>
  );
}
