import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { fmtMoney, monthKey, monthLabel, todayISO } from '../lib/format';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, Legend,
} from 'recharts';

export default function Analytics({ currency }: { currency: string }) {
  const txs = useLiveQuery(() => db.transactions.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const curMonth = monthKey(todayISO());

  const monthTx = txs.filter((t) => monthKey(t.date) === curMonth && t.type === 'expense');

  const pieData = useMemo(() => {
    const byCat = new Map<number, number>();
    monthTx.forEach((t) => byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount));
    return Array.from(byCat.entries())
      .map(([id, val]) => ({ name: catMap.get(id)?.name || 'Other', value: val, color: catMap.get(id)?.color || '#888' }))
      .sort((a, b) => b.value - a.value);
  }, [monthTx, categories]);

  const trendData = useMemo(() => {
    const months: string[] = [];
    const d = new Date();
    for (let i = 5; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push(m.toISOString().slice(0, 7));
    }
    return months.map((m) => {
      const spend = txs.filter((t) => monthKey(t.date) === m && t.type === 'expense').reduce((s, t) => s + t.amount, 0);
      const income = txs.filter((t) => monthKey(t.date) === m && t.type === 'income').reduce((s, t) => s + t.amount, 0);
      return { month: monthLabel(m).split(' ')[0], spend, income };
    });
  }, [txs]);

  const budgetVsActual = categories.map((c) => ({
    name: c.name.length > 8 ? c.name.slice(0, 7) + '…' : c.name,
    budget: c.budget,
    actual: monthTx.filter((t) => t.categoryId === c.id).reduce((s, t) => s + t.amount, 0),
  }));

  const totalSpent = monthTx.reduce((s, t) => s + t.amount, 0);
  const topCategory = pieData[0];

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Insights</div>
        <h1>Analytics</h1>
        <div className="sub">{monthLabel(curMonth)}</div>
      </header>
      <div className="content">
        <div className="card">
          <h2>Where it went</h2>
          {pieData.length === 0 ? (
            <div className="empty"><div className="glyph">◔</div>Nothing to chart yet — log a few expenses.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="var(--bg-card)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtMoney(Number(v), currency)} contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="muted" style={{ textAlign: 'center', marginTop: -8 }}>
                Top: <b style={{ color: 'var(--ink)' }}>{topCategory?.name}</b> at {totalSpent > 0 ? ((topCategory.value / totalSpent) * 100).toFixed(0) : 0}% of spend
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>6-month trend</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="month" stroke="var(--ink-soft)" fontSize={11} />
              <YAxis stroke="var(--ink-soft)" fontSize={11} width={40} />
              <Tooltip formatter={(v) => fmtMoney(Number(v), currency)} contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="spend" stroke="var(--over)" strokeWidth={2} dot={false} name="Spend" />
              <Line type="monotone" dataKey="income" stroke="var(--good)" strokeWidth={2} dot={false} name="Income" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Budget vs actual</h2>
          {budgetVsActual.length === 0 ? (
            <div className="empty"><div className="glyph">▤</div>Add categories to compare.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, budgetVsActual.length * 44)}>
              <BarChart data={budgetVsActual} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                <XAxis type="number" stroke="var(--ink-soft)" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="var(--ink-soft)" fontSize={11} width={64} />
                <Tooltip formatter={(v) => fmtMoney(Number(v), currency)} contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="budget" fill="var(--ink-faint)" radius={[0, 4, 4, 0]} name="Budget" />
                <Bar dataKey="actual" fill="var(--brass)" radius={[0, 4, 4, 0]} name="Actual" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </>
  );
}

const tooltipStyle = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--ink)',
};
