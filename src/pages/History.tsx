import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "react-router-dom";
import { db, type Transaction } from "../db/db";
import {
  fmtMoney,
  monthKey,
  monthLabel,
  shortDate,
  todayISO,
} from "../lib/format";
import { useUIStore } from "../store/useUIStore";
import CalendarHeatmap from "../components/CalendarHeatmap";
import { List, CalendarDays, Inbox, X } from "lucide-react";
import Dropdown from "../components/Dropdown";
import { useNavigate } from "react-router-dom";

export default function History({ currency }: { currency: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const showToast = useUIStore((s) => s.showToast);
  const allTx = useLiveQuery(() => db.transactions.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const catMap = new Map(categories.map((c) => [c.id, c]));

  const [month, setMonth] = useState(monthKey(todayISO()));
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const catFilter = params.get("cat") ? Number(params.get("cat")) : null;
  const [lastDeleted, setLastDeleted] = useState<Transaction | null>(null);

  const months = useMemo(() => {
    const set = new Set(allTx.map((t) => monthKey(t.date)));
    set.add(monthKey(todayISO()));
    return Array.from(set).sort().reverse();
  }, [allTx]);

  const filtered = allTx
    .filter((t) => monthKey(t.date) === month)
    .filter((t) => (catFilter ? t.categoryId === catFilter : true))
    .filter((t) => (dayFilter ? t.date === dayFilter : true))
    .filter((t) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      const cat = catMap.get(t.categoryId);
      return (
        (t.note || "").toLowerCase().includes(q) ||
        (t.merchant || "").toLowerCase().includes(q) ||
        (cat?.name || "").toLowerCase().includes(q) ||
        String(t.amount).includes(q)
      );
    })
    .sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
    );

  const monthTotal = filtered
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);

  async function del(t: Transaction) {
    await db.transactions.delete(t.id!);
    setLastDeleted(t);
    showToast("Deleted — tap Undo to restore");
  }
  async function undo() {
    if (!lastDeleted) return;
    const { id, ...rest } = lastDeleted;
    await db.transactions.add(rest);
    setLastDeleted(null);
    showToast("Restored.");
  }

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">History</div>
        <h1>Transactions</h1>
        <div className="sub">
          {fmtMoney(monthTotal, currency)} spent this view
        </div>
      </header>
      <div className="content">
        <div className="card">
          <div className="row2">
            <Dropdown
              value={month}
              onChange={(v) => {
                setMonth(v);
                setDayFilter(null);
              }}
              options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
            />
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="chip-row">
            <button
              className={"chip" + (view === "list" ? " active" : "")}
              onClick={() => setView("list")}
            >
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <List size={13} /> List
              </span>
            </button>
            <button
              className={"chip" + (view === "calendar" ? " active" : "")}
              onClick={() => setView("calendar")}
            >
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <CalendarDays size={13} /> Calendar
              </span>
            </button>
          </div>
          {catFilter && (
            <div className="chip-row">
              <button className="chip active" onClick={() => setParams({})}>
                {catMap.get(catFilter)?.name || "Category"}{" "}
                <X
                  size={12}
                  style={{ display: "inline", verticalAlign: "middle" }}
                />
              </button>
            </div>
          )}
          {dayFilter && (
            <div className="chip-row">
              <button
                className="chip active"
                onClick={() => setDayFilter(null)}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  {dayFilter} <X size={12} />
                </span>
              </button>
            </div>
          )}
        </div>

        {view === "calendar" && (
          <div className="card">
            <h2>Spending heatmap</h2>
            <CalendarHeatmap
              month={month}
              transactions={allTx}
              currency={currency}
              onSelectDay={setDayFilter}
            />
          </div>
        )}

        <div className="card">
          {filtered.length === 0 ? (
            <div className="empty">
              <div className="glyph">
                <Inbox size={30} strokeWidth={1.5} />
              </div>
              Nothing here yet.
            </div>
          ) : (
            filtered.map((t) => {
              const c = catMap.get(t.categoryId);
              return (
                <div
                  className="tx tx-link"
                  key={t.id}
                  onClick={() => navigate(`/transaction/${t.id}`)}
                >
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
                      <div className="tx-cat">
                        {c?.name || "Uncategorized"}
                        {t.merchant ? " · " + t.merchant : ""}
                      </div>
                      {t.note && <div className="tx-note">{t.note}</div>}
                      <div className="tx-date">
                        {shortDate(t.date)}
                        {t.paymentMethod ? " · " + t.paymentMethod : ""}
                      </div>
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
                    <button
                      className="icon-btn danger"
                      aria-label="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        del(t);
                      }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {lastDeleted && (
          <button className="btn secondary" onClick={undo}>
            Undo delete
          </button>
        )}
      </div>
    </>
  );
}
