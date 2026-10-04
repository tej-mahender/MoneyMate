import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db, type SplitShare } from "../db/db";
import { fmtMoney, shortDate, iconBadgeStyle, roundMoney } from "../lib/format";
import { ChevronLeft, ChevronRight, HandCoins, Check } from "lucide-react";

/**
 * The only screen in the app that knows split expenses exist at all. Every
 * category/budget figure elsewhere is computed purely from each
 * Transaction's own `amount`, which only ever holds the logged-in user's
 * own share of a split expense — this page is where the *other* people's
 * shares (SplitShare rows) live and get tracked and settled, entirely
 * outside the budget/transaction system. Settling a debt here never
 * creates a Transaction and never touches any category — the money was
 * never counted as spent by the user in the first place.
 */
export default function SplitTracker({ currency }: { currency: string }) {
  const navigate = useNavigate();
  const shares = useLiveQuery(() => db.splitShares.toArray(), []) ?? [];
  const transactions = useLiveQuery(() => db.transactions.toArray(), []) ?? [];
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const [selected, setSelected] = useState<string | null>(null); // lowercased person key
  const [partialDrafts, setPartialDrafts] = useState<Record<number, string>>(
    {},
  );

  type PersonSummary = {
    key: string;
    name: string;
    outstanding: number;
    shares: SplitShare[];
  };
  const byPerson = new Map<string, PersonSummary>();
  for (const s of shares) {
    const key = s.personName.trim().toLowerCase();
    const entry = byPerson.get(key) ?? {
      key,
      name: s.personName.trim(),
      outstanding: 0,
      shares: [],
    };
    entry.outstanding += s.amountOwed - s.amountSettled;
    entry.shares.push(s);
    byPerson.set(key, entry);
  }
  const allPeople = [...byPerson.values()];
  // A tiny epsilon guards against float rounding leaving someone at
  // ₹0.0000000001 "outstanding" forever after a full settle.
  const outstandingPeople = allPeople
    .filter((p) => p.outstanding > 0.005)
    .sort((a, b) => b.outstanding - a.outstanding);
  const settledPeople = allPeople
    .filter((p) => p.outstanding <= 0.005)
    .sort((a, b) => a.name.localeCompare(b.name));
  const totalOutstanding = outstandingPeople.reduce(
    (s, p) => s + p.outstanding,
    0,
  );

  async function settleFully(share: SplitShare) {
    await db.splitShares.update(share.id!, { amountSettled: share.amountOwed });
  }
  async function settlePartial(share: SplitShare) {
    const raw = partialDrafts[share.id!];
    const amt = roundMoney(parseFloat(raw));
    if (!amt || amt <= 0) return;
    const remaining = roundMoney(share.amountOwed - share.amountSettled);
    const applied = Math.min(amt, remaining);
    await db.splitShares.update(share.id!, {
      amountSettled: roundMoney(share.amountSettled + applied),
    });
    setPartialDrafts((prev) => ({ ...prev, [share.id!]: "" }));
  }

  const person = selected ? byPerson.get(selected) : null;

  if (person) {
    // Newest expense first — recent context matters more than old history
    // when you're trying to remember "wait, what was this for again".
    const sorted = [...person.shares].sort((a, b) => b.createdAt - a.createdAt);
    return (
      <>
        <header className="topbar">
          <button
            className="icon-btn"
            aria-label="Back to Owed to you"
            onClick={() => setSelected(null)}
            style={{ marginBottom: 10 }}
          >
            <ChevronLeft size={18} />
          </button>
          <div className="eyebrow">Owed to you</div>
          <h1>{person.name}</h1>
          <div className="sub">
            {person.outstanding > 0.005
              ? `${fmtMoney(person.outstanding, currency)} outstanding`
              : "All settled up"}
          </div>
        </header>
        <div className="content">
          <div className="card">
            <h2>Expenses</h2>
            {sorted.map((s) => {
              const tx = txById.get(s.transactionId);
              const cat = tx ? catById.get(tx.categoryId) : undefined;
              const remaining = s.amountOwed - s.amountSettled;
              const isSettled = remaining <= 0.005;
              const pctPaid = Math.min(100, Math.round((s.amountSettled / s.amountOwed) * 100));

              return (
                <div
                  key={s.id}
                  className={`split-expense-card ${isSettled ? "settled" : ""}`}
                >
                  <div className="split-card-header">
                    <div className="split-card-left">
                      <div className="tx-icon" style={iconBadgeStyle(cat?.color)}>
                        {cat?.icon || "＊"}
                      </div>
                      <div className="split-card-meta">
                        <div className="split-card-cat">
                          <span>{cat?.name || "Uncategorized"}</span>
                          {tx?.merchant && (
                            <span className="split-card-merchant">
                              · {tx.merchant}
                            </span>
                          )}
                        </div>
                        <div className="split-card-date">
                          {tx ? shortDate(tx.date) : "Split Expense"}
                        </div>
                      </div>
                    </div>
                    {isSettled ? (
                      <span className="split-badge-settled">
                        <Check size={13} /> Paid
                      </span>
                    ) : (
                      <span className="split-badge-due">
                        {fmtMoney(remaining, currency)} due
                      </span>
                    )}
                  </div>

                  <div className="split-card-breakdown">
                    <span>
                      Total share: <b>{fmtMoney(s.amountOwed, currency)}</b>
                    </span>
                    {s.amountSettled > 0 && !isSettled ? (
                      <span style={{ color: "var(--good)" }}>
                        Paid so far: <b>{fmtMoney(s.amountSettled, currency)}</b> ({pctPaid}%)
                      </span>
                    ) : null}
                  </div>

                  {s.amountSettled > 0 && !isSettled && (
                    <div className="split-card-progress">
                      <div
                        className="split-card-progress-bar"
                        style={{ width: `${pctPaid}%` }}
                      />
                    </div>
                  )}

                  {!isSettled && (
                    <div className="split-card-actions">
                      <button
                        className="split-btn-full"
                        onClick={() => settleFully(s)}
                      >
                        <Check size={14} /> Mark full {fmtMoney(remaining, currency)} paid
                      </button>
                      <div className="split-partial-box">
                        <div className="split-input-wrap">
                          <span className="split-curr-sign">
                            {currency === "INR" ? "₹" : currency}
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            placeholder="Partial amount"
                            value={partialDrafts[s.id!] ?? ""}
                            onChange={(e) =>
                              setPartialDrafts((prev) => ({
                                ...prev,
                                [s.id!]: e.target.value,
                              }))
                            }
                            onWheel={(ev) => ev.currentTarget.blur()}
                          />
                        </div>
                        <button
                          className="split-btn-record"
                          disabled={
                            !partialDrafts[s.id!] ||
                            parseFloat(partialDrafts[s.id!]!) <= 0
                          }
                          onClick={() => settlePartial(s)}
                        >
                          Record
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  // Helper: get the initials for a person's avatar badge
  function initials(name: string) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }

  // Helper: get the most recent transaction info for a person's shares
  function recentShareContext(shares: SplitShare[]) {
    const sorted = [...shares].sort((a, b) => b.createdAt - a.createdAt);
    const first = sorted[0];
    if (!first) return null;
    const tx = txById.get(first.transactionId);
    const cat = tx ? catById.get(tx.categoryId) : undefined;
    return {
      catName: cat?.name || "Uncategorized",
      catIcon: cat?.icon || "＊",
      date: tx ? shortDate(tx.date) : "",
    };
  }

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Money Mate</div>
        <h1>Owed to you</h1>
        <div className="sub">Split expenses you're owed back on</div>
      </header>
      <div className="content">
        <div className="grid-3" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <div className="label">Total outstanding</div>
            <div className="value">{fmtMoney(totalOutstanding, currency)}</div>
          </div>
        </div>

        <div className="card">
          <h2>People</h2>
          {outstandingPeople.length === 0 && (
            <div className="empty">
              <div className="glyph">
                <HandCoins size={30} strokeWidth={1.5} />
              </div>
              Nobody owes you anything right now. Split an expense next time
              you're covering the bill, and it'll show up here.
            </div>
          )}
          {outstandingPeople.map((p) => {
            const ctx = recentShareContext(p.shares);
            return (
              <div
                key={p.key}
                className="person-row"
                onClick={() => setSelected(p.key)}
              >
                <div className="person-avatar">{initials(p.name)}</div>
                <div className="person-info">
                  <div className="person-name">{p.name}</div>
                  <div className="person-sub">
                    {p.shares.length} expense{p.shares.length === 1 ? "" : "s"}
                    {ctx ? ` · ${ctx.catIcon} ${ctx.catName}` : ""}
                  </div>
                </div>
                <div className="person-amount">
                  <b>{fmtMoney(p.outstanding, currency)}</b>
                  <ChevronRight size={16} className="muted" />
                </div>
              </div>
            );
          })}
        </div>

        {settledPeople.length > 0 && (
          <div className="card">
            <h2>Settled up</h2>
            {settledPeople.map((p) => {
              const totalSettled = p.shares.reduce(
                (s, sh) => s + sh.amountOwed,
                0,
              );
              const ctx = recentShareContext(p.shares);
              return (
                <div
                  key={p.key}
                  className="settled-row"
                  onClick={() => setSelected(p.key)}
                >
                  <div className="person-avatar settled">
                    {initials(p.name)}
                  </div>
                  <div className="settled-info">
                    <div className="settled-name">{p.name}</div>
                    <div className="settled-sub">
                      {fmtMoney(totalSettled, currency)} across{" "}
                      {p.shares.length} expense
                      {p.shares.length === 1 ? "" : "s"}
                      {ctx ? ` · ${ctx.date}` : ""}
                    </div>
                  </div>
                  <div className="settled-badge">
                    <Check size={13} /> Paid
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button className="btn secondary" onClick={() => navigate("/add")}>
          Log a split expense
        </button>
      </div>
    </>
  );
}
