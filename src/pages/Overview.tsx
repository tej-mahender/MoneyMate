import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db, type Bracket, type BracketKind } from "../db/db";
import { fmtMoney, monthKey, monthLabel, todayISO, iconBadgeStyle } from "../lib/format";
import { Wallet, HelpCircle, Plus, ChevronRight } from "lucide-react";

const KIND_ORDER: Record<BracketKind, number> = { spend: 0, allocation: 1, income: 2 };

/**
 * Home — the landing screen ("/"), and the top of the hierarchy: income →
 * brackets (Expenditure / Savings / Investments / Income / any custom ones)
 * → drill into a bracket's own page for its Rent/Food/Portfolio/Gold/etc.
 * sub-category detail. "Money you haven't given a job to" lives front and
 * center here, not buried behind a tap from a category-level screen.
 */
export default function Overview({
  currency,
  monthlyIncome,
}: {
  currency: string;
  monthlyIncome: number;
}) {
  const navigate = useNavigate();
  const curMonth = monthKey(todayISO());

  const brackets = (useLiveQuery(() => db.brackets.toArray(), []) ?? [])
    .filter((b) => !b.archived)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id! - b.id!));
  const allCats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const txs = useLiveQuery(() => db.transactions.toArray(), []) ?? [];
  const monthTx = txs.filter((t) => monthKey(t.date) === curMonth);

  const activeCats = allCats.filter((c) => !c.archived);
  const catsByBracket = new Map<number, typeof activeCats>();
  for (const c of activeCats) {
    const list = catsByBracket.get(c.bracketId) ?? [];
    list.push(c);
    catsByBracket.set(c.bracketId, list);
  }

  function bracketFigures(bracket: Bracket) {
    const cats = catsByBracket.get(bracket.id!) ?? [];
    const catIds = new Set(cats.map((c) => c.id));
    const relevantType = bracket.kind === "income" ? "income" : "expense";
    const target = cats.reduce((s, c) => s + c.budget, 0);
    const actual = monthTx
      .filter((t) => t.type === relevantType && catIds.has(t.categoryId))
      .reduce((s, t) => s + t.amount, 0);
    return { target, actual, categoryCount: cats.length };
  }

  const spendBrackets = brackets.filter((b) => b.kind === "spend");
  const allocationBrackets = brackets.filter((b) => b.kind === "allocation");
  const incomeBrackets = brackets.filter((b) => b.kind === "income");

  const spendCapTotal = spendBrackets.reduce((s, b) => s + bracketFigures(b).target, 0);
  const spendActualTotal = spendBrackets.reduce((s, b) => s + bracketFigures(b).actual, 0);
  const allocationTargetTotal = allocationBrackets.reduce((s, b) => s + bracketFigures(b).target, 0);
  const allocationActualTotal = allocationBrackets.reduce((s, b) => s + bracketFigures(b).actual, 0);
  const loggedIncome = incomeBrackets.reduce((s, b) => s + bracketFigures(b).actual, 0);
  const totalIncome = monthlyIncome + loggedIncome;
  // "Allocated" on the summary tile is the complement of "Unallocated" —
  // every rupee that's been given a job, whether that's a spend cap
  // (Expenditure) or a target (Savings/Investments/EMI…). It deliberately
  // reflects what's been *planned* (category budgets), not what's been
  // *spent/moved* so far this month — a savings target set during
  // onboarding should read as allocated immediately, not only once a
  // transaction is logged against it. Actual movement this month is its
  // own, separate figure (see "Left right now" below).
  const allocatedTotal = spendCapTotal + allocationTargetTotal;

  // Unbudgeted/other spend — real money out, but not tied to (or not
  // capped by) any spend-bracket category: a spend category left at 0
  // budget, or a transaction whose category was deleted/never set.
  const cappedCategoryIds = new Set(
    spendBrackets.flatMap((b) => (catsByBracket.get(b.id!) ?? []).filter((c) => c.budget > 0).map((c) => c.id)),
  );
  const allocationCategoryIds = new Set(
    allocationBrackets.flatMap((b) => (catsByBracket.get(b.id!) ?? []).map((c) => c.id)),
  );
  const unbudgetedTx = monthTx.filter(
    (t) =>
      t.type === "expense" &&
      !allocationCategoryIds.has(t.categoryId) &&
      !cappedCategoryIds.has(t.categoryId),
  );
  const unbudgetedSpent = unbudgetedTx.reduce((s, t) => s + t.amount, 0);

  const trackIncome = totalIncome > 0;
  const unallocated = totalIncome - spendCapTotal - allocationTargetTotal;
  const actualLeftover = totalIncome - spendActualTotal - allocationActualTotal - unbudgetedSpent;

  function bracketSubtitle(bracket: Bracket, target: number, actual: number) {
    if (bracket.kind === "income") return `${fmtMoney(actual, currency)} logged this month`;
    if (target === 0) return `${fmtMoney(actual, currency)} spent, no target set`;
    const left = target - actual;
    if (bracket.kind === "spend") {
      return left >= 0
        ? `${fmtMoney(actual, currency)} spent of ${fmtMoney(target, currency)}`
        : `${fmtMoney(-left, currency)} over ${fmtMoney(target, currency)} budget`;
    }
    return `${fmtMoney(actual, currency)} of ${fmtMoney(target, currency)} target`;
  }

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Money Mate</div>
        <h1>Home</h1>
        <div className="sub">{monthLabel(curMonth)} · where income went</div>
      </header>
      <div className="content">
        {trackIncome ? (
          <div className="grid-3">
            <div>
              <div className="label">Income</div>
              <div className="value">{fmtMoney(totalIncome, currency)}</div>
            </div>
            <div>
              <div className="label">Allocated</div>
              <div className="value">{fmtMoney(allocatedTotal, currency)}</div>
            </div>
            <div className={unallocated < 0 ? "neg" : "pos"}>
              <div className="label">Unallocated</div>
              <div className="value">{fmtMoney(unallocated, currency)}</div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <HelpCircle size={18} style={{ color: "var(--ink-faint)", flexShrink: 0, marginTop: 2 }} />
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              No income set — each bracket below still tracks its own spend/target. Set a monthly income in{" "}
              <button
                style={{ font: "inherit", color: "var(--ink)", fontWeight: 600, textDecoration: "underline", padding: 0, background: "none", border: "none", cursor: "pointer" }}
                onClick={() => navigate("/settings")}
              >
                Settings
              </button>{" "}
              to see income, allocations, and what's left unallocated, all together.
            </div>
          </div>
        )}

        <div className="card">
          <h2>Brackets</h2>
          {brackets.length === 0 ? (
            <div className="empty">
              <div className="glyph">
                <Wallet size={30} strokeWidth={1.5} />
              </div>
              No brackets yet — add one in Settings.
            </div>
          ) : (
            brackets.map((b) => {
              const { target, actual } = bracketFigures(b);
              return (
                <div
                  key={b.id}
                  className="tx tx-link"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  onClick={() => navigate("/bracket/" + b.id)}
                >
                  <div className="tx-left">
                    <div className="tx-icon" style={iconBadgeStyle(b.color)}>
                      {b.icon}
                    </div>
                    <div className="tx-meta">
                      <div className="tx-cat">{b.name}</div>
                      <div className="tx-note">{bracketSubtitle(b, target, actual)}</div>
                    </div>
                  </div>
                  <ChevronRight size={18} style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
                </div>
              );
            })
          )}
          <button className="btn secondary" onClick={() => navigate("/settings")} style={{ marginTop: 8 }}>
            <Plus size={15} style={{ verticalAlign: -2, marginRight: 4 }} />
            Add bracket
          </button>
        </div>

        <div className="card">
          <h2>
            Other spend
            <span className="muted" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
              unbudgeted
            </span>
          </h2>
          {unbudgetedTx.length === 0 ? (
            <div className="empty">
              <div className="glyph">
                <Wallet size={30} strokeWidth={1.5} />
              </div>
              Nothing outside your budgeted categories this month.
            </div>
          ) : (
            <div
              className="tx tx-link"
              style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}
              onClick={() => navigate("/history")}
            >
              <div className="tx-meta">
                <div className="tx-cat">{fmtMoney(unbudgetedSpent, currency)}</div>
                <div className="tx-note">
                  {unbudgetedTx.length} transaction{unbudgetedTx.length === 1 ? "" : "s"} against
                  zero-budget or uncategorized categories
                </div>
              </div>
            </div>
          )}
        </div>

        {trackIncome && (
          <div className="card" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <HelpCircle size={18} style={{ color: "var(--ink-faint)", flexShrink: 0, marginTop: 2 }} />
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              <b style={{ color: "var(--ink)" }}>Unallocated</b> = income − every spend bracket's cap − every
              allocation bracket's target. It's your plan check: a positive number means you haven't given
              every rupee a job yet; negative means you've planned more than you earn.{" "}
              <b style={{ color: "var(--ink)" }}>Left right now</b> is{" "}
              {fmtMoney(actualLeftover, currency)}, based on what's actually been spent/allocated so far this
              month.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
