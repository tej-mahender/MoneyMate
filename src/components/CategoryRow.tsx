import type { Category } from '../db/db';
import { fmtMoney } from '../lib/format';

export default function CategoryRow({
  category,
  spent,
  currency,
  onClick,
}: {
  category: Category;
  spent: number;
  currency: string;
  onClick?: () => void;
}) {
  const pct = category.budget > 0 ? (spent / category.budget) * 100 : spent > 0 ? 100 : 0;
  const state = pct < 75 ? 'good' : pct < 100 ? 'warn' : 'over';
  const color = `var(--${state})`;
  return (
    <div className="cat-row" onClick={onClick}>
      <div className="row-top">
        <span className="name">
          <span className="icon">{category.icon}</span>
          {category.name}
        </span>
        <span className="figs">
          <b>{fmtMoney(spent, currency)}</b> / {fmtMoney(category.budget, currency)}
        </span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: Math.min(pct, 100) + '%', background: color }} />
      </div>
      <div className="pct-tag" style={{ color: state === 'over' ? 'var(--over)' : undefined }}>
        {pct.toFixed(0)}% used
        {pct > 100 ? ` · over by ${fmtMoney(spent - category.budget, currency)}` : ''}
      </div>
    </div>
  );
}
