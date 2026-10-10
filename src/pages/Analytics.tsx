import { useEffect, useMemo, useState } from "react";
import { EMPTY_LIST } from "../lib/stable";
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
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
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
} from "recharts";

// Donut geometry (SVG viewBox units). Drawn by hand rather than through
// Recharts' <Pie>: its sector hit-testing made taps land on neighbouring
// slices, and a hand-built ring gives exact control over gaps and selection.
const DONUT_SIZE = 252;
const DONUT_R = 86; // ring centre-line radius
const DONUT_THICK = 32;
const DONUT_GAP_PX = 3; // visible gap between neighbouring slices
const DONUT_CORNER = 5; // corner rounding radius
const DONUT_GROW = 4; // how far the selected slice swells

/** Annular sector with rounded corners. The shape is inset by the corner
 *  radius and then stroked with a round-joined stroke of the same colour,
 *  which rounds every corner to that radius. */
function sectorPath(
  start: number,
  sweep: number,
  grow: number,
): { d: string; cr: number } {
  // Thin slices get a smaller corner radius so they stay a visible pill of
  // exactly their allotted width instead of bloating into their neighbours.
  const arcLen = ((sweep * Math.PI) / 180) * DONUT_R;
  const cr = Math.min(DONUT_CORNER, Math.max(0.5, (arcLen - DONUT_GAP_PX) / 2 - 0.5));
  const c = DONUT_SIZE / 2;
  const rOut = DONUT_R + DONUT_THICK / 2 + grow - cr;
  const rIn = DONUT_R - DONUT_THICK / 2 - grow + cr;
  const inset = DONUT_GAP_PX / 2 + cr; // px from the slice edge
  const pt = (r: number, a: number) => {
    const rad = (a * Math.PI) / 180;
    return `${(c + r * Math.sin(rad)).toFixed(2)} ${(c - r * Math.cos(rad)).toFixed(2)}`;
  };
  const span = (r: number) => {
    const d = (inset / r) * (180 / Math.PI); // constant pixel gap at every radius
    let a1 = start + d;
    let a2 = start + sweep - d;
    if (a2 - a1 < 0.2) {
      const mid = start + sweep / 2;
      a1 = mid - 0.1;
      a2 = mid + 0.1;
    }
    return [a1, a2] as const;
  };
  const [o1, o2] = span(rOut);
  const [i1, i2] = span(rIn);
  return {
    cr,
    d:
    `M${pt(rOut, o1)}A${rOut} ${rOut} 0 ${o2 - o1 > 180 ? 1 : 0} 1 ${pt(rOut, o2)}` +
    `L${pt(rIn, i2)}A${rIn} ${rIn} 0 ${i2 - i1 > 180 ? 1 : 0} 0 ${pt(rIn, i1)}Z`,
  };
}

// Slice colours are assigned by rank (not from each category's own colour)
// so no two slices ever share a hue; adjacent ranks are deliberately far
// apart on the colour wheel. Past the curated set, hues keep coming from a
// golden-angle sweep so every category still gets its own colour.
const PIE_PALETTE = [
  "#F5B84B", // amber
  "#4FB3F5", // sky
  "#FF6B6B", // coral
  "#3DDC97", // mint
  "#A78BFA", // violet
  "#F472B6", // pink
  "#B8E04A", // lime
  "#22D3EE", // cyan
  "#FB923C", // orange
  "#D946EF", // magenta
  "#14B8A6", // teal
  "#818CF8", // periwinkle
];
const pieColor = (i: number) =>
  i < PIE_PALETTE.length
    ? PIE_PALETTE[i]
    : `hsl(${Math.round((i * 137.508) % 360)} 68% 62%)`;
// Slices smaller than this still get a visible sliver of the ring.
const PIE_MIN_SWEEP = 5;
// The legend opens on the biggest few categories; the rest sit behind a
// "Show all" toggle so a long tail doesn't push the other cards off screen.
const LEGEND_PREVIEW = 5;

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
  const txs = useLiveQuery(() => db.transactions.toArray(), []) ?? EMPTY_LIST;
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? EMPTY_LIST;
  const brackets = useLiveQuery(() => db.brackets.toArray(), []) ?? EMPTY_LIST;
  // Money moved into an allocation bracket (Savings/Investments/EMI…) is
  // logged as an ordinary expense-type transaction, but it isn't spend —
  // Dashboard already excludes it from "Spent"; every figure derived from
  // rangeExpenses below (pie chart, trend line, top merchants, insights)
  // needs the same exclusion so a savings transfer doesn't inflate them.
  const allocationCategoryIds = useMemo(() => {
    const allocationBracketIds = new Set(
      brackets.filter((b) => b.kind === "allocation").map((b) => b.id),
    );
    return new Set(
      categories.filter((c) => allocationBracketIds.has(c.bracketId)).map((c) => c.id),
    );
  }, [brackets, categories]);
  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const todayMonth = monthKey(todayISO());
  // Only meaningful when range === "month" — for every other range (3m,
  // 6m, 1y, all) the window still trails back from today, same as before.
  // Every existing calculation below already derives from this single
  // `curMonth` value, so this is the only change needed to let "Month"
  // browse any past month's isolated snapshot instead of always meaning
  // "today's month" with no way to step back to a closed one.
  const [monthOffset, setMonthOffset] = useState(0);
  const curMonth = range === "month" ? addMonths(todayMonth, monthOffset) : todayMonth;

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
  const rangeExpenses = useMemo(
    () =>
      rangeTx.filter(
        (t) => t.type === "expense" && !allocationCategoryIds.has(t.categoryId),
      ),
    [rangeTx, allocationCategoryIds],
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
  }, [rangeExpenses, catMap]);

  // Month-over-month movers. For the month still in progress, last month is
  // cut off at the same day so the comparison is like-for-like.
  const vsPrev = useMemo(() => {
    if (range !== "month") return null;
    const prevMonth = addMonths(curMonth, -1);
    const partial = curMonth === todayMonth;
    const dayCap = partial ? todayISO().slice(8, 10) : "31";
    const cur = new Map<number, number>();
    const prev = new Map<number, number>();
    for (const t of txs) {
      if (t.type !== "expense" || allocationCategoryIds.has(t.categoryId)) continue;
      const m = monthKey(t.date);
      if (m === curMonth) cur.set(t.categoryId, (cur.get(t.categoryId) ?? 0) + t.amount);
      else if (m === prevMonth && t.date.slice(8, 10) <= dayCap)
        prev.set(t.categoryId, (prev.get(t.categoryId) ?? 0) + t.amount);
    }
    const curTotal = [...cur.values()].reduce((a, b) => a + b, 0);
    const prevTotal = [...prev.values()].reduce((a, b) => a + b, 0);
    if (prevTotal === 0) return null; // nothing to compare against
    const ids = new Set([...cur.keys(), ...prev.keys()]);
    const movers = [...ids]
      .map((id) => {
        const c = cur.get(id) ?? 0;
        const p = prev.get(id) ?? 0;
        const cat = catMap.get(id);
        return {
          id,
          name: cat?.name ?? "Uncategorized",
          icon: cat?.icon ?? "＊",
          cur: c,
          prev: p,
          delta: c - p,
        };
      })
      .filter((m) => m.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5);
    return {
      prevMonth,
      partial,
      dayCap: Number(dayCap),
      curTotal,
      prevTotal,
      delta: curTotal - prevTotal,
      movers,
    };
  }, [range, txs, catMap, allocationCategoryIds, curMonth, todayMonth]);

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
  }, [rangeExpenses, monthKeys, txs, catMap]);

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
  }, [rangeExpenses, txs, startMonth, range, allocationCategoryIds]);

  const [activePie, setActivePie] = useState<number | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  const pieSlices = useMemo(() => {
    const total = pieData.reduce((s, d) => s + d.value, 0) || 1;
    return pieData.map((d, i) => ({
      ...d,
      color: pieColor(i),
      pct: (d.value / total) * 100,
    }));
  }, [pieData]);
  const pieArcs = useMemo(() => {
    const n = pieSlices.length;
    // Give every slice at least PIE_MIN_SWEEP degrees, taking the difference
    // proportionally from the larger ones so the ring still adds up to 360.
    const floor = Math.min(PIE_MIN_SWEEP, 360 / n / 2);
    const raw = pieSlices.map((d) => (d.pct / 100) * 360);
    const small = raw.filter((v) => v < floor);
    const bigTotal = raw.reduce((a, v) => (v < floor ? a : a + v), 0);
    const scale = bigTotal > 0 ? (360 - small.length * floor) / bigTotal : 1;
    const sweeps = raw.map((v) => (v < floor ? floor : v * scale));
    let cursor = 0;
    return pieSlices.map((_, i) => {
      const grow = activePie === i ? DONUT_GROW : 0;
      const shape = n === 1 ? null : sectorPath(cursor, sweeps[i], grow);
      cursor += sweeps[i];
      return { full: n === 1, path: shape?.d ?? "", cr: shape?.cr ?? 0 };
    });
  }, [pieSlices, activePie]);
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);
  // Tapping anywhere outside a slice or legend row clears the selection.
  useEffect(() => {
    if (activePie === null) return;
    const clear = (e: Event) => {
      const t = e.target as Element | null;
      if (t && t.closest && t.closest(".pie-arc, .pie-row")) return;
      setActivePie(null);
    };
    document.addEventListener("click", clear);
    return () => document.removeEventListener("click", clear);
  }, [activePie]);
  // A slice picked on the ring that the collapsed legend hides opens it, so
  // the selected row is never out of sight.
  const legendExpanded =
    legendOpen || (activePie !== null && activePie >= LEGEND_PREVIEW);
  const legendRows = legendExpanded
    ? pieSlices
    : pieSlices.slice(0, LEGEND_PREVIEW);
  const focused =
    activePie !== null && activePie < pieSlices.length ? pieSlices[activePie] : null;

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Insights</div>
        <h1>Analytics</h1>
        <div className="sub">{range === "month" ? monthLabel(curMonth) : RANGE_LABEL[range]}</div>
      </header>
      <div className="content">
        <div className="chip-row" style={{ marginBottom: 16 }}>
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button
              key={r}
              className={"chip" + (range === r ? " active" : "")}
              onClick={() => {
                setRange(r);
                setMonthOffset(0);
              }}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>

        {range === "month" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 16 }}>
            <button
              className="icon-btn"
              aria-label="Previous month"
              onClick={() => setMonthOffset((o) => o - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 600, minWidth: 150, textAlign: "center" }}>
              {monthLabel(curMonth)}
            </div>
            <button
              className="icon-btn"
              aria-label="Next month"
              disabled={monthOffset >= 0}
              onClick={() => setMonthOffset((o) => Math.min(0, o + 1))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}

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
                <svg
                  viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
                  className="pie-svg"
                  aria-hidden="true"
                >
                  <circle
                    cx={DONUT_SIZE / 2}
                    cy={DONUT_SIZE / 2}
                    r={DONUT_R}
                    fill="none"
                    stroke="var(--surface)"
                    strokeWidth={DONUT_THICK}
                  />
                  {pieSlices.map((d, i) => {
                    const common = {
                      className: "pie-arc",
                      style: {
                        opacity: activePie === null || activePie === i ? 1 : 0.28,
                      },
                      onClick: () => setActivePie((cur) => (cur === i ? null : i)),
                    };
                    return pieArcs[i].full ? (
                      <circle
                        key={i}
                        cx={DONUT_SIZE / 2}
                        cy={DONUT_SIZE / 2}
                        r={DONUT_R}
                        fill="none"
                        stroke={d.color}
                        strokeWidth={DONUT_THICK + (activePie === i ? DONUT_GROW * 2 : 0)}
                        {...common}
                      />
                    ) : (
                      <path
                        key={i}
                        d={pieArcs[i].path}
                        fill={d.color}
                        stroke={d.color}
                        strokeWidth={pieArcs[i].cr * 2}
                        strokeLinejoin="round"
                        {...common}
                      />
                    );
                  })}
                </svg>
                <div className="pie-center" aria-live="polite">
                  <div className="pie-center-label">
                    {focused ? focused.name : "Total spent"}
                  </div>
                  <div
                    className="pie-center-value"
                    style={{
                      fontSize:
                        fmtMoney(focused ? focused.value : pieTotal, currency).length > 9
                          ? 17
                          : fmtMoney(focused ? focused.value : pieTotal, currency).length > 7
                            ? 21
                            : 25,
                    }}
                  >
                    {fmtMoney(focused ? focused.value : pieTotal, currency)}
                  </div>
                  <div className="pie-center-sub">
                    {focused
                      ? `${focused.pct.toFixed(focused.pct < 10 ? 1 : 0)}% of spend`
                      : `${pieData.length} ${pieData.length === 1 ? "category" : "categories"}`}
                  </div>
                </div>
              </div>

              <ul className="pie-legend">
                {legendRows.map((d, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={
                        "pie-row" +
                        (activePie === i ? " active" : "") +
                        (activePie !== null && activePie !== i ? " dim" : "")
                      }
                      aria-pressed={activePie === i}
                      onClick={() => setActivePie((cur) => (cur === i ? null : i))}
                    >
                      <span className="pie-dot" style={{ background: d.color }} />
                      <span className="pie-name">{d.name}</span>
                      <span className="pie-pct">
                        {d.pct < 1 ? "<1" : d.pct.toFixed(d.pct < 10 ? 1 : 0)}%
                      </span>
                      <span className="pie-amt">{fmtMoney(d.value, currency)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {pieSlices.length > LEGEND_PREVIEW && (
                <button
                  type="button"
                  className="pie-more"
                  onClick={() => {
                    setLegendOpen((o) => !o);
                    if (legendExpanded) setActivePie(null);
                  }}
                >
                  {legendExpanded
                    ? "Show fewer"
                    : `Show all ${pieSlices.length}`}
                </button>
              )}
            </>
          )}
        </div>

        {range === "month" && vsPrev && (
          <div className="card">
            <h2>
              Vs. {monthLabel(vsPrev.prevMonth)}
              <span className="muted" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                {vsPrev.partial ? `day 1–${vsPrev.dayCap}` : "full month"}
              </span>
            </h2>
            <div className="vs-total">
              <b>{fmtMoney(vsPrev.curTotal, currency)}</b>
              <span className="muted">vs {fmtMoney(vsPrev.prevTotal, currency)}</span>
              <span className={"vs-delta " + (vsPrev.delta > 0 ? "up" : vsPrev.delta < 0 ? "down" : "")}>
                {vsPrev.delta === 0
                  ? "no change"
                  : `${vsPrev.delta > 0 ? "▲" : "▼"} ${fmtMoney(Math.abs(vsPrev.delta), currency)}${
                      vsPrev.prevTotal > 0
                        ? ` (${Math.abs((vsPrev.delta / vsPrev.prevTotal) * 100).toFixed(0)}%)`
                        : ""
                    }`}
              </span>
            </div>
            {vsPrev.movers.map((m) => (
              <div className="vs-row" key={m.id}>
                <span className="vs-name">
                  <span className="icon">{m.icon}</span>
                  {m.name}
                </span>
                <span className="vs-amt">{fmtMoney(m.cur, currency)}</span>
                <span className={"vs-delta " + (m.delta > 0 ? "up" : "down")}>
                  {m.prev === 0
                    ? "new"
                    : `${m.delta > 0 ? "▲" : "▼"} ${fmtMoney(Math.abs(m.delta), currency)}`}
                </span>
              </div>
            ))}
            {vsPrev.partial && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Compared with the same stretch of {monthLabel(vsPrev.prevMonth)}, so a month in progress isn't judged against a finished one.
              </div>
            )}
          </div>
        )}

        {range !== "month" && (
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
        )}

        {range !== "month" && categoryTrend.topIds.length > 0 && (
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
