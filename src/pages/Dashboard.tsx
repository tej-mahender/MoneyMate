import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db, computeMonthSummary } from "../db/db";
import {
  fmtMoney,
  monthKey,
  monthLabel,
  todayISO,
  shortDate,
  daysInMonth,
  dayOfMonthProgress,
  iconBadgeStyle,
} from "../lib/format";
import CategoryRow from "../components/CategoryRow";
import Ring from "../components/Ring";
import { syncWidget } from "../lib/widgetBridge";
import { Wallet, Receipt } from "lucide-react";

// The Budget screen — capped spending categories only (Rent, Food,
// Transport…), aggregated across every 'spend'-kind bracket (usually just
// Expenditure, but not assumed to be the only one). Deliberately knows
// nothing about income, savings, or investments; that picture lives on
// Home ("/"), which is where you land after onboarding and where "money
// you haven't given a job to" is front and center. See db.ts BracketKind
// for the full model.
export default function Dashboard({
  currency,
  hideWidgetAmounts,
}: {
  currency: string;
  hideWidgetAmounts?: boolean;
}) {
  const navigate = useNavigate();
  const curMonth = monthKey(todayISO());

  const brackets = useLiveQuery(() => db.brackets.toArray(), []) ?? [];
  const spendBracketIds = new Set(
    brackets.filter((b) => b.kind === "spend" && !b.archived).map((b) => b.id),
  );
  // Allocation exclusion intentionally isn't archived-filtered — an
  // archived Savings bracket's transactions still shouldn't get swept into
  // "Spent" against the budget cap just because the bracket is hidden.
  const allocationBracketIds = new Set(
    brackets.filter((b) => b.kind === "allocation").map((b) => b.id),
  );
  const allCats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const categories = allCats.filter(
    (c) => !c.archived && spendBracketIds.has(c.bracketId),
  );
  const allocationCategoryIds = new Set(
    allCats
      .filter((c) => allocationBracketIds.has(c.bracketId))
      .map((c) => c.id),
  );
  const txs = useLiveQuery(() => db.transactions.toArray(), []) ?? [];

  const monthTx = txs.filter((t) => monthKey(t.date) === curMonth);
  // Excludes transactions logged against allocation categories (e.g. an
  // expense-type entry moving money into Savings) — those aren't spend
  // against the budget cap. Uncategorized/orphaned transactions are still
  // counted here (treated as unbudgeted spend, same as before).
  const spentTx = monthTx.filter(
    (t) => t.type === "expense" && !allocationCategoryIds.has(t.categoryId),
  );

  // The top-line Budgeted/Spent/Remaining figures come from
  // computeMonthSummary() — the same indexed-query calculation the widget
  // uses — rather than a second hand-rolled copy of this math living only
  // here. Two independent implementations of "what does Budget mean" is
  // exactly the failure mode that's bitten this app before (Dashboard once
  // silently disagreed with Home/BracketDetail about archived categories);
  // routing both through one function makes that class of bug structurally
  // impossible instead of something to remember to keep in sync by hand.
  const summary = useLiveQuery(() => computeMonthSummary(), [curMonth]) ?? {
    spent: 0,
    budget: 0,
    remaining: 0,
    monthKey: curMonth,
  };
  const totalBudget = summary.budget;
  const totalSpent = summary.spent;
  const remaining = summary.remaining;

  const elapsed = dayOfMonthProgress(curMonth);
  const totalDays = daysInMonth(curMonth);
  const dailyAvg = elapsed > 0 ? totalSpent / elapsed : 0;

  const today = todayISO();
  const todaySpend = spentTx
    .filter((t) => t.date === today)
    .reduce((s, t) => s + t.amount, 0);

  const recent = txs
    .slice()
    .sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
    )
    .slice(0, 6);

  const catMap = new Map(allCats.map((c) => [c.id, c]));

  const budgetPctRaw = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const budgetPct = Math.min(budgetPctRaw, 100);
  const ringState =
    budgetPctRaw < 75 ? "good" : budgetPctRaw < 100 ? "warn" : "over";
  const ringColor = `var(--${ringState === "warn" ? "gold" : ringState})`;

  // Per-category spend this month, for the large widget's mini breakdown.
  // Sorted by spend (not budget) so the rows show "what's actually eating
  // your month" rather than just whatever has the biggest allocation.
  const catSpendMap = new Map<number, number>();
  for (const t of spentTx) {
    if (t.categoryId == null) continue;
    catSpendMap.set(
      t.categoryId,
      (catSpendMap.get(t.categoryId) ?? 0) + t.amount,
    );
  }
  const topCategories = categories
    .map((c) => ({
      name: c.name,
      icon: c.icon,
      color: c.color,
      spent: catSpendMap.get(c.id!) ?? 0,
      budget: c.budget,
    }))
    .filter((c) => c.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 4);

  useEffect(() => {
    syncWidget({
      spent: totalSpent,
      budget: totalBudget,
      remaining,
      currency,
      monthLabel: monthLabel(curMonth),
      hideAmounts: !!hideWidgetAmounts,
      categories: topCategories,
    });
    // topCategories is derived fresh each render from txs/categories, which
    // are already tracked below — stringify keeps the effect from firing on
    // every render when the underlying spend hasn't actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    totalSpent,
    totalBudget,
    remaining,
    currency,
    curMonth,
    hideWidgetAmounts,
    JSON.stringify(topCategories),
  ]);

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Money Mate</div>
        <h1>Budget</h1>
        <div className="sub">{monthLabel(curMonth)}</div>
      </header>
      <div className="content">
        <div className="grid-3">
          <div>
            <div className="label">Budgeted</div>
            <div className="value">{fmtMoney(totalBudget, currency)}</div>
          </div>
          <div>
            <div className="label">Spent</div>
            <div className="value">{fmtMoney(totalSpent, currency)}</div>
          </div>
          <div className={remaining < 0 ? "neg" : "pos"}>
            <div className="label">Remaining</div>
            <div className="value">{fmtMoney(remaining, currency)}</div>
          </div>
        </div>

        <div className="card">
          <h2>Budget health</h2>
          <div className="ring-wrap">
            <Ring pct={budgetPct} color={ringState} />
            <div className="ring-figs">
              <div className="big" style={{ color: ringColor }}>
                {budgetPctRaw.toFixed(0)}%
              </div>
              <div className="lbl">
                of {fmtMoney(totalBudget, currency)} budget used
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>
            By category
            <span
              className="muted"
              style={{ fontFamily: "var(--mono)", fontSize: 11 }}
            >
              {monthLabel(curMonth)}
            </span>
          </h2>
          {(categories ?? []).length === 0 ? (
            <div className="empty">
              <div className="glyph">
                <Wallet size={30} strokeWidth={1.5} />
              </div>
              No budget categories yet — add one in Settings.
            </div>
          ) : (
            (categories ?? []).map((c) => {
              const spent = spentTx
                .filter((t) => t.categoryId === c.id)
                .reduce((s, t) => s + t.amount, 0);
              return (
                <CategoryRow
                  key={c.id}
                  category={c}
                  spent={spent}
                  currency={currency}
                  onClick={() => navigate("/history?cat=" + c.id)}
                />
              );
            })
          )}
        </div>

        <div className="grid-3">
          <div>
            <div className="label">Today</div>
            <div className="value">{fmtMoney(todaySpend, currency)}</div>
          </div>
          <div>
            <div className="label">Daily avg</div>
            <div className="value">{fmtMoney(dailyAvg, currency)}</div>
          </div>
          <div>
            <div className="label">Days left</div>
            <div className="value">{Math.max(0, totalDays - elapsed)}</div>
          </div>
        </div>

        <div className="card">
          <h2>
            Recent transactions
            <button
              className="btn small secondary"
              onClick={() => navigate("/history")}
            >
              View all
            </button>
          </h2>
          {recent.length === 0 ? (
            <div className="empty">
              <div className="glyph">
                <Receipt size={30} strokeWidth={1.5} />
              </div>
              No transactions logged yet.
            </div>
          ) : (
            recent.map((t) => {
              const c = catMap.get(t.categoryId);
              return (
                <div
                  className="tx tx-link"
                  key={t.id}
                  onClick={() => navigate(`/transaction/${t.id}`)}
                >
                  <div className="tx-left">
                    <div className="tx-icon" style={iconBadgeStyle(c?.color)}>
                      {c?.icon || "＊"}
                    </div>
                    <div className="tx-meta">
                      <div className="tx-cat">{c?.name || "Uncategorized"}</div>
                      {t.note && <div className="tx-note">{t.note}</div>}
                      <div className="tx-date">{shortDate(t.date)}</div>
                    </div>
                  </div>
                  <div className="tx-right">
                    <span
                      className={
                        "tx-amt" + (t.type === "income" ? " income" : "")
                      }
                    >
                      {t.type === "income" ? "+" : "−"}
                      {fmtMoney(t.amount, currency)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
