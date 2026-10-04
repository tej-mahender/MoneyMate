import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db, computeMonthSummary } from "../db/db";
import {
  fmtMoney,
  monthKey,
  monthLabel,
  addMonths,
  todayISO,
  shortDate,
  daysInMonth,
  dayOfMonthProgress,
  iconBadgeStyle,
} from "../lib/format";
import CategoryRow from "../components/CategoryRow";
import Ring from "../components/Ring";
import MonthReview from "../components/MonthReview";
import { Wallet, Receipt, ChevronLeft, ChevronRight, CalendarCheck, X } from "lucide-react";

// The Budget screen — capped spending categories only (Rent, Food,
// Transport…), aggregated across every 'spend'-kind bracket (usually just
// Expenditure, but not assumed to be the only one). Deliberately knows
// nothing about income, savings, or investments; that picture lives on
// Home ("/"), which is where you land after onboarding and where "money
// you haven't given a job to" is front and center. See db.ts BracketKind
// for the full model.
// The month-end prompt is dismissed per month and remembered on-device only
// (nothing here is data worth putting in the database or a backup).
const REVIEW_PROMPT_KEY = "moneymate.reviewPromptDismissed";
function readPromptDismissed(): string | null {
  try {
    return localStorage.getItem(REVIEW_PROMPT_KEY);
  } catch {
    return null;
  }
}
function writePromptDismissed(month: string) {
  try {
    localStorage.setItem(REVIEW_PROMPT_KEY, month);
  } catch {
    /* private mode / storage disabled — the prompt just returns next visit */
  }
}

export default function Dashboard({ currency }: { currency: string }) {
  const navigate = useNavigate();
  const curMonth = monthKey(todayISO());
  const [params] = useSearchParams();
  // The month being viewed: the live month by default, or any earlier month
  // (read-only review). ?month=yyyy-mm deep-links straight to one, e.g. from
  // History. A future or malformed value falls back to the live month.
  const requested = params.get("month");
  const [viewMonth, setViewMonth] = useState(
    requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) && requested < curMonth
      ? requested
      : curMonth,
  );
  const isPast = viewMonth < curMonth;
  // First week of a new month: offer last month's review once, if there is
  // anything to review.
  const prevMonth = addMonths(curMonth, -1);
  const prevMonthTxCount =
    useLiveQuery(
      () => db.transactions.where("date").startsWith(prevMonth).count(),
      [prevMonth],
    ) ?? 0;
  const [promptDismissed, setPromptDismissed] = useState(
    () => readPromptDismissed() === prevMonth,
  );
  const showReviewPrompt =
    !isPast &&
    Number(todayISO().slice(8, 10)) <= 7 &&
    prevMonthTxCount > 0 &&
    !promptDismissed;
  function dismissPrompt() {
    writePromptDismissed(prevMonth);
    setPromptDismissed(true);
  }
  // Earliest month with any data, so the back arrow stops where there is
  // nothing to review instead of paging through empty years.
  const earliestMonth =
    useLiveQuery(async () => {
      const first = await db.transactions.orderBy("date").first();
      const hist = await db.budgetHistory.orderBy("month").first();
      const cands = [first ? monthKey(first.date) : null, hist?.month ?? null].filter(
        (m): m is string => !!m,
      );
      return cands.length ? cands.sort()[0] : curMonth;
    }, [curMonth]) ?? curMonth;

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

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Money Mate</div>
        <h1>Budget</h1>
        <div
          className="sub"
          style={{ display: "flex", alignItems: "center", gap: 4 }}
        >
          <button
            className="icon-btn"
            aria-label="Previous month"
            disabled={viewMonth <= earliestMonth}
            onClick={() => setViewMonth((m) => addMonths(m, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <span>{monthLabel(viewMonth)}</span>
          <button
            className="icon-btn"
            aria-label="Next month"
            disabled={!isPast}
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight size={16} />
          </button>
          {isPast && (
            <button
              className="btn small secondary"
              style={{ marginLeft: "auto" }}
              onClick={() => setViewMonth(curMonth)}
            >
              This month
            </button>
          )}
        </div>
      </header>
      <div className="content">
        {isPast ? (
          <MonthReview
            month={viewMonth}
            currency={currency}
            onOpenCategory={(id) =>
              navigate(`/history?cat=${id}&month=${viewMonth}`)
            }
          />
        ) : (
        <>
        {showReviewPrompt && (
          <div className="card review-prompt">
            <CalendarCheck size={20} className="review-prompt-icon" />
            <div className="review-prompt-text">
              <b>{monthLabel(prevMonth)} is wrapped up</b>
              <span className="muted">See how it went against your budget.</span>
            </div>
            <button
              className="btn small"
              onClick={() => {
                dismissPrompt();
                setViewMonth(prevMonth);
              }}
            >
              Review
            </button>
            <button
              className="icon-btn"
              aria-label="Dismiss"
              onClick={dismissPrompt}
            >
              <X size={16} />
            </button>
          </div>
        )}
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
        </>
        )}
      </div>
    </>
  );
}
