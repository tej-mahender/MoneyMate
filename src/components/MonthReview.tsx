import { useLiveQuery } from "dexie-react-hooks";
import { computeMonthReport, type Category } from "../db/db";
import { fmtMoney, monthLabel } from "../lib/format";
import CategoryRow from "./CategoryRow";
import Ring from "./Ring";
import { Receipt } from "lucide-react";

/** Read-only "how did that month go" view for a closed month: verdict,
 *  budgeted vs spent, and every category against the cap that applied then.
 *  All figures come from computeMonthReport() — the same function the
 *  current-month Budget screen uses — so the two can never disagree. */
export default function MonthReview({
  month,
  currency,
  onOpenCategory,
}: {
  month: string;
  currency: string;
  onOpenCategory: (categoryId: number) => void;
}) {
  const report = useLiveQuery(() => computeMonthReport(month), [month]);
  if (!report) return <div className="skeleton" style={{ height: 230 }} />;

  const nothing =
    report.rows.length === 0 &&
    report.allocations.length === 0 &&
    report.income === 0 &&
    report.uncategorizedSpent === 0;
  if (nothing) {
    return (
      <div className="card">
        <div className="empty">
          <div className="glyph">
            <Receipt size={30} strokeWidth={1.5} />
          </div>
          Nothing recorded for {monthLabel(month)}.
        </div>
      </div>
    );
  }

  const diff = Math.abs(report.remaining);
  const verdictText =
    report.budgeted === 0
      ? "No budget was set"
      : report.verdict === "over"
        ? `Over budget by ${fmtMoney(diff, currency)}`
        : report.verdict === "on"
          ? "Exactly on budget"
          : `Under budget by ${fmtMoney(diff, currency)}`;
  const ringState =
    report.usedPct < 75 ? "good" : report.usedPct < 100 ? "warn" : "over";
  const ringColor = `var(--${ringState === "warn" ? "gold" : ringState})`;
  const asRow = (r: { categoryId: number; name: string; icon: string; color: string }, budget: number): Category => ({
    id: r.categoryId,
    name: r.name,
    icon: r.icon,
    color: r.color,
    budget,
    bracketId: 0,
  });

  return (
    <>
      <div className="grid-3">
        <div>
          <div className="label">Budgeted</div>
          <div className="value">{fmtMoney(report.budgeted, currency)}</div>
        </div>
        <div>
          <div className="label">Spent</div>
          <div className="value">{fmtMoney(report.spent, currency)}</div>
        </div>
        <div className={report.remaining < 0 ? "neg" : "pos"}>
          <div className="label">{report.remaining < 0 ? "Over by" : "Left"}</div>
          <div className="value">{fmtMoney(diff, currency)}</div>
        </div>
      </div>

      <div className="card">
        <h2>Month result</h2>
        <div className="ring-wrap">
          <Ring pct={Math.min(report.usedPct, 100)} color={ringState} />
          <div className="ring-figs">
            <div className="big" style={{ color: ringColor }}>
              {report.usedPct.toFixed(0)}%
            </div>
            <div className="lbl">{verdictText}</div>
          </div>
        </div>
        {report.overCount > 0 && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            {report.overCount} {report.overCount === 1 ? "category" : "categories"} went over its cap
          </div>
        )}
        {report.approximate && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Approximate — budget tracking started after this month, so caps shown are the earliest recorded.
          </div>
        )}
      </div>

      {report.rows.length > 0 && (
        <div className="card">
          <h2>
            By category
            <span className="muted" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
              {monthLabel(month)}
            </span>
          </h2>
          {report.rows.map((r) => (
            <CategoryRow
              key={r.categoryId}
              category={asRow(r, r.budget)}
              spent={r.spent}
              currency={currency}
              onClick={() => onOpenCategory(r.categoryId)}
            />
          ))}
          {(report.unbudgetedSpent > 0 || report.uncategorizedSpent > 0) && (
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              {report.unbudgetedSpent > 0 &&
                `${fmtMoney(report.unbudgetedSpent, currency)} was spent in categories with no budget. `}
              {report.uncategorizedSpent > 0 &&
                `${fmtMoney(report.uncategorizedSpent, currency)} is uncategorized and not counted above.`}
            </div>
          )}
        </div>
      )}

      {report.allocations.length > 0 && (
        <div className="card">
          <h2>Savings &amp; investments</h2>
          {report.allocations.map((a) => (
            <CategoryRow
              key={a.categoryId}
              category={asRow(a, a.target)}
              spent={a.actual}
              currency={currency}
              isAllocation
              onClick={() => onOpenCategory(a.categoryId)}
            />
          ))}
        </div>
      )}

      {report.income > 0 && (
        <div className="grid-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="pos">
            <div className="label">Income</div>
            <div className="value">{fmtMoney(report.income, currency)}</div>
          </div>
          <div className={report.income - report.spent < 0 ? "neg" : "pos"}>
            <div className="label">Income − spent</div>
            <div className="value">{fmtMoney(report.income - report.spent, currency)}</div>
          </div>
        </div>
      )}
    </>
  );
}
