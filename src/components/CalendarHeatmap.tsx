import { useMemo, useState } from "react";
import type { Transaction } from "../db/db";
import { fmtMoney, monthKey, todayISO } from "../lib/format";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function CalendarHeatmap({
  month,
  transactions,
  currency,
  onSelectDay,
}: {
  month: string; // YYYY-MM
  transactions: Transaction[];
  currency: string;
  onSelectDay?: (iso: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const dayTotals = useMemo(() => {
    const map = new Map<string, number>();
    transactions
      .filter((t) => t.type === "expense" && monthKey(t.date) === month)
      .forEach((t) => map.set(t.date, (map.get(t.date) || 0) + t.amount));
    return map;
  }, [transactions, month]);

  const max = Math.max(1, ...Array.from(dayTotals.values()));

  const [year, mo] = month.split("-").map(Number);
  const firstDay = new Date(year, mo - 1, 1);
  const startWeekday = firstDay.getDay();
  const totalDays = new Date(year, mo, 0).getDate();
  const today = todayISO();

  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) {
    cells.push(`${month}-${String(d).padStart(2, "0")}`);
  }

  function intensity(iso: string | null): number {
    if (!iso) return -1;
    const val = dayTotals.get(iso) || 0;
    if (val === 0) return 0;
    return Math.min(1, val / max);
  }

  function bg(level: number): string {
    if (level < 0) return "transparent";
    if (level === 0) return "var(--void-elev)";
    // interpolate between good and over via warn using level
    if (level < 0.34)
      return (
        "color-mix(in srgb, var(--good) " +
        Math.round(30 + level * 150) +
        "%, var(--void-elev))"
      );
    if (level < 0.7)
      return (
        "color-mix(in srgb, var(--warn) " +
        Math.round(40 + level * 90) +
        "%, var(--void-elev))"
      );
    return (
      "color-mix(in srgb, var(--over) " +
      Math.round(50 + level * 80) +
      "%, var(--void-elev))"
    );
  }

  const activeDay = selected || (cells.includes(today) ? today : null);
  const activeTotal = activeDay ? dayTotals.get(activeDay) || 0 : 0;

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7,1fr)",
          gap: 5,
          marginBottom: 8,
        }}
      >
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            style={{
              textAlign: "center",
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-faint)",
            }}
          >
            {w}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7,1fr)",
          gap: 5,
        }}
      >
        {cells.map((iso, i) => {
          const lvl = intensity(iso);
          const isToday = iso === today;
          const isSel = iso === activeDay;
          return (
            <button
              key={i}
              disabled={!iso}
              onClick={() => {
                if (!iso) return;
                setSelected(iso);
                onSelectDay?.(iso);
              }}
              style={{
                aspectRatio: "1",
                borderRadius: 7,
                border: isSel
                  ? "1.5px solid var(--gold)"
                  : isToday
                    ? "1px solid var(--ink-faint)"
                    : "1px solid transparent",
                background: bg(lvl),
                cursor: iso ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: lvl > 0.5 ? "#fff" : "var(--ink-soft)",
                padding: 0,
              }}
            >
              {iso ? Number(iso.slice(-2)) : ""}
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 14,
        }}
      >
        <div className="muted" style={{ fontSize: 11.5 }}>
          {activeDay
            ? `${activeDay} · ${fmtMoney(activeTotal, currency)} spent`
            : "Tap a day for its total"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span className="muted" style={{ fontSize: 10 }}>
            less
          </span>
          {[0, 0.25, 0.5, 0.75, 1].map((l) => (
            <span
              key={l}
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: bg(l),
              }}
            />
          ))}
          <span className="muted" style={{ fontSize: 10 }}>
            more
          </span>
        </div>
      </div>
    </div>
  );
}
