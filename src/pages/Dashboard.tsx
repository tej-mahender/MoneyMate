import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db } from "../db/db";
import {
  fmtMoney,
  monthKey,
  monthLabel,
  todayISO,
  shortDate,
  daysInMonth,
  dayOfMonthProgress,
} from "../lib/format";
import CategoryRow from "../components/CategoryRow";
import { syncWidget } from "../lib/widgetBridge";
import { Wallet, Receipt } from "lucide-react";

export default function Dashboard({
  currency,
  monthlyIncome,
}: {
  currency: string;
  monthlyIncome: number;
}) {
  const navigate = useNavigate();
  const curMonth = monthKey(todayISO());

  const allCats = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const categories = allCats.filter((c) => !c.archived && c.type !== "income");
  const txs = useLiveQuery(() => db.transactions.toArray(), []) ?? [];

  const monthTx = txs.filter((t) => monthKey(t.date) === curMonth);
  const spentTx = monthTx.filter((t) => t.type === "expense");
  const incomeTx = monthTx.filter((t) => t.type === "income");

  const totalBudget = allCats
    .filter((c) => c.type !== "income")
    .reduce((s, c) => s + c.budget, 0);
  const totalSpent = spentTx.reduce((s, t) => s + t.amount, 0);
  // Fixed salary counts automatically every month without needing to be logged as
  // a transaction; anything logged as income (bonus, freelance) adds on top of it.
  const loggedIncome = incomeTx.reduce((s, t) => s + t.amount, 0);
  const totalIncome = monthlyIncome + loggedIncome;
  const trackIncome = monthlyIncome > 0;
  // "Remaining" must tally with whatever figure it's shown beside in the top row:
  // Income − Spent when income tracking is on, Budget − Spent when it's off. It was
  // previously always budget-based even when displayed next to Income, which meant
  // the two numbers had no arithmetic relationship to each other at all.
  const remaining = trackIncome
    ? totalIncome - totalSpent
    : totalBudget - totalSpent;
  const budgetRemaining = totalBudget - totalSpent;
  const savings = totalIncome - totalSpent;
  const savingsPct = totalIncome > 0 ? (savings / totalIncome) * 100 : 0;

  const elapsed = dayOfMonthProgress(curMonth);
  const totalDays = daysInMonth(curMonth);
  const dailyAvg = elapsed > 0 ? totalSpent / elapsed : 0;
  //  const projected = dailyAvg * totalDays;

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

  const budgetPct =
    totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;
  const ringState = budgetPct < 75 ? "good" : budgetPct < 100 ? "warn" : "over";
  const ringColor = `var(--${ringState === "warn" ? "gold" : ringState})`;

  useEffect(() => {
    syncWidget({
      spent: totalSpent,
      budget: totalBudget,
      remaining: budgetRemaining,
      currency,
      monthLabel: monthLabel(curMonth),
    });
  }, [totalSpent, totalBudget, budgetRemaining, currency, curMonth]);

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Money Mate</div>
        <h1>Dashboard</h1>
        <div className="sub">{monthLabel(curMonth)}</div>
      </header>
      <div className="content">
        <div className="grid-3">
          {trackIncome ? (
            <div>
              <div className="label">Income</div>
              <div className="value">{fmtMoney(totalIncome, currency)}</div>
            </div>
          ) : (
            <div>
              <div className="label">Budgeted</div>
              <div className="value">{fmtMoney(totalBudget, currency)}</div>
            </div>
          )}
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
                {budgetPct.toFixed(0)}%
              </div>
              <div className="lbl">
                of {fmtMoney(totalBudget, currency)} budget used
              </div>
              {/* <div className="lbl" style={{ marginTop: 6 }}>
                Projected month-end spend: <b style={{ color: 'var(--ink)' }}>{fmtMoney(projected, currency)}</b>
              </div> */}
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
              No categories yet — add one in Settings.
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
          {trackIncome ? (
            <div className={savings >= 0 ? "pos" : "neg"}>
              <div className="label">Savings</div>
              <div className="value">
                {savingsPct
                  ? savingsPct.toFixed(0) + "%"
                  : fmtMoney(savings, currency)}
              </div>
            </div>
          ) : (
            <div>
              <div className="label">Days left</div>
              <div className="value">{Math.max(0, totalDays - elapsed)}</div>
            </div>
          )}
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
                <div className="tx" key={t.id}>
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

function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(pct, 100) / 100) * c;
  const gradId = "ring-grad-" + color.replace(/[^a-z]/gi, "");
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop
            offset="0%"
            stopColor={
              color === "over"
                ? "var(--rose)"
                : color === "warn"
                  ? "var(--warn)"
                  : "var(--good)"
            }
          />
          <stop
            offset="100%"
            stopColor={
              color === "over"
                ? "var(--over)"
                : color === "warn"
                  ? "var(--gold)"
                  : "var(--good)"
            }
          />
        </linearGradient>
      </defs>
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke="var(--surface-border-strong)"
        strokeWidth="8"
      />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 40 40)"
        style={{ transition: "stroke-dashoffset .6s cubic-bezier(.16,1,.3,1)" }}
      />
    </svg>
  );
}
