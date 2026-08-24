import type { Category } from "../db/db";
import { fmtMoney } from "../lib/format";
import { progressState } from "../lib/budgetLogic";

export default function CategoryRow({
  category,
  spent,
  currency,
  isAllocation = false,
  onClick,
}: {
  category: Category;
  spent: number;
  currency: string;
  isAllocation?: boolean;
  onClick?: () => void;
}) {
  // A category that's never been budgeted or spent against has nothing to
  // report — showing "₹0 / ₹0 · 0% used" on every one of these is exactly
  // the kind of repeated, meaningless-per-instance text that makes a list
  // read as a debug dump rather than a considered piece of UI. Silence
  // here is more informative than a number that's always zero.
  const isEmpty = category.budget === 0 && spent === 0;
  const pct = category.budget > 0 ? (spent / category.budget) * 100 : spent > 0 ? 100 : 0;
  const state = progressState(pct, isAllocation);
  return (
    <div className="cat-row" onClick={onClick}>
      <div className="row-top">
        <span className="name">
          <span className="icon">{category.icon}</span>
          {category.name}
        </span>
        {!isEmpty && (
          <span className="figs">
            <b>{fmtMoney(spent, currency)}</b>
            {category.budget > 0 && <> / {fmtMoney(category.budget, currency)}</>}
          </span>
        )}
      </div>
      {isEmpty ? (
        <div className="cat-row-empty">Not budgeted yet</div>
      ) : (
        <>
          {category.budget > 0 && (
            <div className="bar-track">
              <div
                className={`bar-fill ${state}`}
                style={{ width: Math.min(pct, 100) + "%" }}
              />
            </div>
          )}
          <div
            className="pct-tag"
            style={{ color: state === "over" ? "var(--over)" : state === "good" && pct >= 100 ? "var(--good)" : undefined }}
          >
            {category.budget > 0 ? (
              <>
                {pct.toFixed(0)}% {isAllocation ? "reached" : "used"}
                {isAllocation && pct >= 100
                  ? ` · exceeded by ${fmtMoney(spent - category.budget, currency)}`
                  : !isAllocation && pct > 100
                    ? ` · over by ${fmtMoney(spent - category.budget, currency)}`
                    : ""}
              </>
            ) : (
              "unbudgeted"
            )}
          </div>
        </>
      )}
    </div>
  );
}
