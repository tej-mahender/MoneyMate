import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import {
  fmtMoney,
  monthKey,
  monthLabel,
  todayISO,
  addMonths,
  weekdayName,
  isoWeek,
  daysBetween,
  iconBadgeStyle,
} from "../lib/format";
import {
  PieChart as PieChartIcon,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
  AreaChart,
  Area,
  type PieLabelRenderProps,
} from "recharts";

const RADIAN = Math.PI / 180;

type Range = "month" | "3m" | "6m" | "1y" | "all";
const RANGE_MONTHS: Record<Range, number> = {
  month: 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
  all: 999,
};
const RANGE_LABEL: Record<Range, string> = {
  month: "This month",
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
  all: "All time",
};

const WEEKDAY_ORDER = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const SERIES_COLORS = [
  "#F0B94D",
  "#4FD9B8",
  "#7C93F0",
  "#E8618C",
  "#B98CF0",
  "#6FC98A",
];

export default function Analytics({ currency }: { currency: string }) {
  const [range, setRange] = useState<Range>("month");
  const txs = useLiveQuery(() => db.transactions.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const brackets = useLiveQuery(() => db.brackets.toArray(), []) ?? [];
  const spendBracketIds = new Set(brackets.filter((b) => b.kind === "spend" && !b.archived).map((b) => b.id));
  // Money moved into an allocation bracket (Savings/Investments/EMI…) is
  // logged as an ordinary expense-type transaction, but it isn't spend —
  // Dashboard already excludes it from "Spent"; every figure derived from
  // rangeExpenses below (pie chart, trend line, top merchants, insights)
  // needs the same exclusion so a savings transfer doesn't inflate them.
  const allocationBracketIds = new Set(brackets.filter((b) => b.kind === "allocation").map((b) => b.id));
  const allocationCategoryIds = new Set(
    categories.filter((c) => allocationBracketIds.has(c.bracketId)).map((c) => c.id),
  );
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const curMonth = monthKey(todayISO());

  const startMonth = useMemo(() => {
    if (range === "all") {
      const earliest = txs.reduce(
        (min, t) => (monthKey(t.date) < min ? monthKey(t.date) : min),
        curMonth,
      );
      return earliest;
    }
    return addMonths(curMonth, -(RANGE_MONTHS[range] - 1));
  }, [range, txs, curMonth]);

  const rangeTx = useMemo(
    () =>
      txs.filter(
        (t) => monthKey(t.date) >= startMonth && monthKey(t.date) <= curMonth,
      ),
    [txs, startMonth, curMonth],
  );
  const rangeExpenses = rangeTx.filter(
    (t) => t.type === "expense" && !allocationCategoryIds.has(t.categoryId),
  );

  // This-month-only slice, since budgets are inherently monthly
  const monthTx = txs.filter(
    (t) => monthKey(t.date) === curMonth && t.type === "expense",
  );

  const pieData = useMemo(() => {
    const byCat = new Map<number, number>();
    rangeExpenses.forEach((t) =>
      byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount),
    );
    return Array.from(byCat.entries())
      .map(([id, val]) => ({
        name: catMap.get(id)?.name || "Other",
        value: val,
        color: catMap.get(id)?.color || "#888",
      }))
      .sort((a, b) => b.value - a.value);
  }, [rangeExpenses, categories]);

  const monthKeys = useMemo(() => {
    const keys: string[] = [];
    let k = startMonth;
    while (k <= curMonth) {
      keys.push(k);
      k = addMonths(k, 1);
    }
    return keys;
  }, [startMonth, curMonth]);

  const trendData = useMemo(
    () =>
      monthKeys.map((m) => {
        const spend = txs
          .filter((t) => monthKey(t.date) === m && t.type === "expense")
          .reduce((s, t) => s + t.amount, 0);
        const income = txs
          .filter((t) => monthKey(t.date) === m && t.type === "income")
          .reduce((s, t) => s + t.amount, 0);
        return {
          month:
            monthLabel(m).split(" ")[0] +
            (monthKeys.length > 12 ? " '" + m.slice(2, 4) : ""),
          spend,
          income,
          savings: income - spend,
        };
      }),
    [monthKeys, txs],
  );

  // Category trend: top categories as stacked area across months
  const categoryTrend = useMemo(() => {
    const totals = new Map<number, number>();
    rangeExpenses.forEach((t) =>
      totals.set(t.categoryId, (totals.get(t.categoryId) || 0) + t.amount),
    );
    const topIds = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
    return {
      topIds,
      data: monthKeys.map((m) => {
        const row: Record<string, string | number> = {
          month: monthLabel(m).split(" ")[0],
        };
        topIds.forEach((id) => {
          row[catMap.get(id)?.name || "Other"] = txs
            .filter(
              (t) =>
                monthKey(t.date) === m &&
                t.type === "expense" &&
                t.categoryId === id,
            )
            .reduce((s, t) => s + t.amount, 0);
        });
        return row;
      }),
    };
  }, [rangeExpenses, monthKeys, txs, categories]);

  const weekdayData = useMemo(() => {
    const totals = new Map<string, { total: number; count: number }>();
    WEEKDAY_ORDER.forEach((w) => totals.set(w, { total: 0, count: 0 }));
    rangeExpenses.forEach((t) => {
      const w = weekdayName(t.date);
      const cur = totals.get(w)!;
      totals.set(w, { total: cur.total + t.amount, count: cur.count + 1 });
    });
    return WEEKDAY_ORDER.map((w) => ({
      day: w.slice(0, 3),
      total: totals.get(w)!.total,
      avg: totals.get(w)!.count
        ? totals.get(w)!.total / totals.get(w)!.count
        : 0,
    }));
  }, [rangeExpenses]);

  // Daily spend + 7-day rolling average — bucket weekly instead if the range spans a lot of days
  const dailySeries = useMemo(() => {
    const spanDays = daysBetween(startMonth + "-01", curMonth + "-01") + 31;
    const byDay = new Map<string, number>();
    rangeExpenses.forEach((t) =>
      byDay.set(t.date, (byDay.get(t.date) || 0) + t.amount),
    );

    if (spanDays <= 100) {
      const days: string[] = [];
      let cursor = startMonth + "-01";
      const end = todayISO();
      while (cursor <= end && monthKey(cursor) <= curMonth) {
        days.push(cursor);
        const d = new Date(cursor + "T00:00:00");
        d.setDate(d.getDate() + 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        cursor = `${y}-${m}-${day}`;
      }
      return days.map((d, i) => {
        const windowStart = Math.max(0, i - 6);
        const window = days.slice(windowStart, i + 1);
        const avg =
          window.reduce((s, wd) => s + (byDay.get(wd) || 0), 0) / window.length;
        return {
          label: d.slice(5),
          spend: byDay.get(d) || 0,
          avg: Math.round(avg),
        };
      });
    }
    // Weekly bucket fallback for long ranges
    const byWeek = new Map<string, number>();
    rangeExpenses.forEach((t) => {
      const key =
        new Date(t.date + "T00:00:00").getFullYear() +
        "-W" +
        String(isoWeek(t.date)).padStart(2, "0");
      byWeek.set(key, (byWeek.get(key) || 0) + t.amount);
    });
    const weeks = Array.from(byWeek.keys()).sort();
    return weeks.map((w, i) => {
      const windowStart = Math.max(0, i - 3);
      const window = weeks.slice(windowStart, i + 1);
      const avg =
        window.reduce((s, wk) => s + (byWeek.get(wk) || 0), 0) / window.length;
      return {
        label: w.slice(6),
        spend: byWeek.get(w) || 0,
        avg: Math.round(avg),
      };
    });
  }, [rangeExpenses, startMonth, curMonth]);

  const topMerchants = useMemo(() => {
    const byMerchant = new Map<string, number>();
    rangeExpenses.forEach((t) => {
      const key = t.merchant?.trim() || null;
      if (!key) return;
      byMerchant.set(key, (byMerchant.get(key) || 0) + t.amount);
    });
    return Array.from(byMerchant.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [rangeExpenses]);

  // Statistical insights — plain arithmetic today, but structured as the first pass
  // of what a future ML model could compute over the same exported data.
  const insights = useMemo(() => {
    const totalSpent = rangeExpenses.reduce((s, t) => s + t.amount, 0);
    const txCount = rangeExpenses.length;
    const avgTx = txCount ? totalSpent / txCount : 0;

    const byDay = new Map<string, number>();
    rangeExpenses.forEach((t) =>
      byDay.set(t.date, (byDay.get(t.date) || 0) + t.amount),
    );
    let peakDay = "",
      peakAmt = 0;
    byDay.forEach((amt, day) => {
      if (amt > peakAmt) {
        peakAmt = amt;
        peakDay = day;
      }
    });

    const byCatCount = new Map<number, number>();
    rangeExpenses.forEach((t) =>
      byCatCount.set(t.categoryId, (byCatCount.get(t.categoryId) || 0) + 1),
    );
    let topCatId: number | null = null,
      topCatCount = 0;
    byCatCount.forEach((c, id) => {
      if (c > topCatCount) {
        topCatCount = c;
        topCatId = id;
      }
    });

    const prevStart = addMonths(startMonth, -RANGE_MONTHS[range]);
    const prevEnd = addMonths(startMonth, -1);
    const prevSpent = txs
      .filter(
        (t) =>
          t.type === "expense" &&
          !allocationCategoryIds.has(t.categoryId) &&
          monthKey(t.date) >= prevStart &&
          monthKey(t.date) <= prevEnd,
      )
      .reduce((s, t) => s + t.amount, 0);
    const momPct =
      prevSpent > 0 ? ((totalSpent - prevSpent) / prevSpent) * 100 : null;

    return {
      totalSpent,
      txCount,
      avgTx,
      peakDay,
      peakAmt,
      topCatId,
      topCatCount,
      momPct,
    };
  }, [rangeExpenses, txs, startMonth, range]);

  // Renders each pie slice's name + amount as a persistent label outside the
  // chart, connected back to its slice by a leader line colored to match —
  // the point being nobody should have to hover/tap a slice just to find out
  // what it is, which barely works on a touch device anyway (no hover state).
  function renderPieLabel(props: PieLabelRenderProps) {
    const { cx, cy, midAngle, outerRadius, name, value, percent, fill } = props;
    // Sub-1% slivers get crowded and unreadable if labeled individually —
    // their color is still visible in the ring itself.
    if (!percent || percent < 0.01) return null;
    const numCx = Number(cx);
    const numCy = Number(cy);
    const numOuterRadius = Number(outerRadius);
    const sin = Math.sin(-RADIAN * Number(midAngle));
    const cos = Math.cos(-RADIAN * Number(midAngle));
    const sx = numCx + (numOuterRadius + 6) * cos;
    const sy = numCy + (numOuterRadius + 6) * sin;
    const mx = numCx + (numOuterRadius + 20) * cos;
    const my = numCy + (numOuterRadius + 20) * sin;
    const rightSide = cos >= 0;
    const ex = mx + (rightSide ? 1 : -1) * 12;
    const ey = my;
    const textAnchor = rightSide ? "start" : "end";
    // Cards on this app's mobile-width layout have far less horizontal room
    // than a desktop chart does — an untruncated long category name (e.g.
    // "Repay Credit Card") could run the label off the edge of the card.
    // The full name is always still available from the Tooltip on tap.
    const label =
      String(name).length > 15 ? `${String(name).slice(0, 14)}…` : name;

    return (
      <g key={name}>
        <path
          d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`}
          stroke={fill}
          strokeWidth={1.5}
          fill="none"
        />
        <circle cx={ex} cy={ey} r={2} fill={fill} stroke="none" />
        <text
          x={ex + (rightSide ? 7 : -7)}
          y={ey - 6}
          textAnchor={textAnchor}
          fontFamily="var(--sans)"
          fontSize={11.5}
          fontWeight={600}
          fill="var(--ink)"
        >
          {label}
        </text>
        <text
          x={ex + (rightSide ? 7 : -7)}
          y={ey + 8}
          textAnchor={textAnchor}
          fontFamily="var(--mono)"
          fontSize={10}
          fill="var(--ink-faint)"
        >
          {fmtMoney(Number(value), currency)}
        </text>
      </g>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Insights</div>
        <h1>Analytics</h1>
        <div className="sub">{RANGE_LABEL[range]}</div>
      </header>
      <div className="content">
        <div className="chip-row" style={{ marginBottom: 16 }}>
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button
              key={r}
              className={"chip" + (range === r ? " active" : "")}
              onClick={() => setRange(r)}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>

        <div className="card">
          <h2>At a glance</h2>
          <div className="grid-3" style={{ marginBottom: 0 }}>
            <div>
              <div className="label">Spent</div>
              <div className="value">
                {fmtMoney(insights.totalSpent, currency)}
              </div>
            </div>
            <div>
              <div className="label">Transactions</div>
              <div className="value">{insights.txCount}</div>
            </div>
            <div>
              <div className="label">Avg / tx</div>
              <div className="value">{fmtMoney(insights.avgTx, currency)}</div>
            </div>
          </div>
          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {insights.momPct !== null && (
              <InsightRow
                icon={
                  insights.momPct > 2 ? (
                    <TrendingUp size={15} />
                  ) : insights.momPct < -2 ? (
                    <TrendingDown size={15} />
                  ) : (
                    <Minus size={15} />
                  )
                }
                color={
                  insights.momPct > 2
                    ? "var(--over)"
                    : insights.momPct < -2
                      ? "var(--good)"
                      : "var(--ink-soft)"
                }
                text={`${insights.momPct > 0 ? "Up" : "Down"} ${Math.abs(insights.momPct).toFixed(0)}% vs. the previous period`}
              />
            )}
            {insights.peakDay && (
              <InsightRow
                icon={<TrendingUp size={15} />}
                color="var(--gold)"
                text={`Biggest spend day: ${insights.peakDay} at ${fmtMoney(insights.peakAmt, currency)}`}
              />
            )}
            {insights.topCatId && (
              <InsightRow
                icon={<PieChartIcon size={15} />}
                color="var(--rose)"
                text={`Most frequent category: ${catMap.get(insights.topCatId)?.name} (${insights.topCatCount} transactions)`}
              />
            )}
          </div>
        </div>

        <div className="card">
          <h2>Where it went</h2>
          {pieData.length === 0 ? (
            <div className="empty">
              <div className="glyph">
                <PieChartIcon size={30} strokeWidth={1.5} />
              </div>
              Nothing to chart yet — log a few expenses.
            </div>
          ) : (
            <>
              <div className="pie-chart-wrap">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius={62}
                      startAngle={90}
                      endAngle={-270}
                      label={renderPieLabel}
                      labelLine={false}
                      isAnimationActive={false}
                    >
                      {pieData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.color}
                          stroke="var(--void-elev)"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => fmtMoney(Number(v), currency)}
                      contentStyle={tooltipStyle}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Income vs. spend</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--surface-border)"
              />
              <XAxis dataKey="month" stroke="var(--ink-soft)" fontSize={11} />
              <YAxis stroke="var(--ink-soft)" fontSize={11} width={40} />
              <Tooltip
                formatter={(v) => fmtMoney(Number(v), currency)}
                contentStyle={tooltipStyle}
              />
              <Line
                type="monotone"
                dataKey="spend"
                stroke="var(--over)"
                strokeWidth={2}
                dot={false}
                name="Spend"
              />
              <Line
                type="monotone"
                dataKey="income"
                stroke="var(--good)"
                strokeWidth={2}
                dot={false}
                name="Income"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {categoryTrend.topIds.length > 0 && (
          <div className="card">
            <h2>Category trend</h2>
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={categoryTrend.data}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--surface-border)"
                />
                <XAxis dataKey="month" stroke="var(--ink-soft)" fontSize={11} />
                <YAxis stroke="var(--ink-soft)" fontSize={11} width={40} />
                <Tooltip
                  formatter={(v) => fmtMoney(Number(v), currency)}
                  contentStyle={tooltipStyle}
                />
                {categoryTrend.topIds.map((id, i) => (
                  <Area
                    key={id}
                    type="monotone"
                    dataKey={catMap.get(id)?.name || "Other"}
                    stackId="1"
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                    fillOpacity={0.35}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="card">
          <h2>Daily spend &amp; 7-day average</h2>
          <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={dailySeries}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--surface-border)"
              />
              <XAxis
                dataKey="label"
                stroke="var(--ink-soft)"
                fontSize={10}
                interval="preserveStartEnd"
              />
              <YAxis stroke="var(--ink-soft)" fontSize={11} width={40} />
              <Tooltip
                formatter={(v) => fmtMoney(Number(v), currency)}
                contentStyle={tooltipStyle}
              />
              <Area
                type="monotone"
                dataKey="spend"
                stroke="var(--ink-faint)"
                fill="var(--surface-strong)"
                name="Daily"
              />
              <Line
                type="monotone"
                dataKey="avg"
                stroke="var(--gold)"
                strokeWidth={2}
                dot={false}
                name="Rolling avg"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2>Spending by day of week</h2>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={weekdayData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--surface-border)"
              />
              <XAxis dataKey="day" stroke="var(--ink-soft)" fontSize={11} />
              <YAxis stroke="var(--ink-soft)" fontSize={11} width={40} />
              <Tooltip
                formatter={(v) => fmtMoney(Number(v), currency)}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="total" fill="var(--gold)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {topMerchants.length > 0 && (
          <div className="card">
            <h2>Top merchants</h2>
            {topMerchants.map(([name, amt], i) => (
              <div className="tx" key={name}>
                <div className="tx-left">
                  <div
                    className="tx-icon"
                    style={iconBadgeStyle(SERIES_COLORS[i % SERIES_COLORS.length])}
                  >
                    {i + 1}
                  </div>
                  <div className="tx-meta">
                    <div className="tx-cat">{name}</div>
                  </div>
                </div>
                <span className="tx-amt">{fmtMoney(amt, currency)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <h2>
            Budget vs actual{" "}
            <span
              className="muted"
              style={{ fontFamily: "var(--mono)", fontSize: 11 }}
            >
              {monthLabel(curMonth)}
            </span>
          </h2>
          {categories.filter((c) => spendBracketIds.has(c.bracketId)).length === 0 ? (
            <div className="empty">
              <div className="glyph">
                <BarChart3 size={30} strokeWidth={1.5} />
              </div>
              Add categories to compare.
            </div>
          ) : (
            <ResponsiveContainer
              width="100%"
              height={Math.max(
                160,
                categories.filter((c) => spendBracketIds.has(c.bracketId)).length * 44,
              )}
            >
              <BarChart
                data={categories
                  .filter((c) => spendBracketIds.has(c.bracketId))
                  .map((c) => ({
                    name: c.name.length > 8 ? c.name.slice(0, 7) + "…" : c.name,
                    budget: c.budget,
                    actual: monthTx
                      .filter((t) => t.categoryId === c.id)
                      .reduce((s, t) => s + t.amount, 0),
                  }))}
                layout="vertical"
                margin={{ left: 10 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--surface-border)"
                  horizontal={false}
                />
                <XAxis type="number" stroke="var(--ink-soft)" fontSize={11} />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="var(--ink-soft)"
                  fontSize={11}
                  width={64}
                />
                <Tooltip
                  formatter={(v) => fmtMoney(Number(v), currency)}
                  contentStyle={tooltipStyle}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="budget"
                  fill="var(--ink-faint)"
                  radius={[0, 4, 4, 0]}
                  name="Budget"
                />
                <Bar
                  dataKey="actual"
                  fill="var(--gold)"
                  radius={[0, 4, 4, 0]}
                  name="Actual"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </>
  );
}

function InsightRow({
  icon,
  color,
  text,
}: {
  icon: React.ReactNode;
  color: string;
  text: string;
}) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
    >
      <span style={{ color, flexShrink: 0, display: "flex" }}>{icon}</span>
      <span style={{ color: "var(--ink-soft)" }}>{text}</span>
    </div>
  );
}

const tooltipStyle = {
  background: "var(--void-elev)",
  border: "1px solid var(--surface-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--ink)",
};
