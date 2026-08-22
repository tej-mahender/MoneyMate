import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../db/db";
import { fmtMoney, longDate, fmtDateTime, iconBadgeStyle } from "../lib/format";
import { useUIStore } from "../store/useUIStore";
import { ChevronLeft, Pencil, Trash2, Repeat, Receipt } from "lucide-react";

export default function TransactionDetail({ currency }: { currency: string }) {
  const { id } = useParams();
  const txId = Number(id);
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);

  // useLiveQuery re-runs automatically if the transaction is edited or
  // deleted elsewhere while this page is open, instead of showing stale data.
  const t = useLiveQuery(() => db.transactions.get(txId), [txId]);
  const category = useLiveQuery(
    () => (t ? db.categories.get(t.categoryId) : undefined),
    [t?.categoryId],
  );
  const recurring = useLiveQuery(
    () => (t?.recurringId ? db.recurring.get(t.recurringId) : undefined),
    [t?.recurringId],
  );

  async function handleDelete() {
    if (!t) return;
    if (!confirm("Delete this transaction? This can't be undone.")) return;
    await db.transactions.delete(t.id!);
    showToast("Transaction deleted.");
    navigate("/history");
  }

  // t === undefined while the query is still loading; null (via .get()
  // resolving to undefined for a missing id) means it genuinely doesn't
  // exist — e.g. already deleted, or a stale/invalid link.
  if (t === undefined) {
    return (
      <>
        <header className="topbar">
          <div className="eyebrow">Transaction</div>
          <h1>Loading…</h1>
        </header>
        <div className="content">
          <div className="skeleton" style={{ height: 96, marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 220 }} />
        </div>
      </>
    );
  }

  if (!t || !t.id) {
    return (
      <>
        <header
          className="topbar"
          style={{ display: "flex", alignItems: "center", gap: 12 }}
        >
          <button
            className="icon-btn"
            aria-label="Back"
            onClick={() => navigate("/history")}
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <div className="eyebrow">Transaction</div>
            <h1 style={{ fontSize: 20 }}>Not found</h1>
          </div>
        </header>
        <div className="content">
          <div className="card">
            <div className="empty">
              <div className="glyph">
                <Receipt size={30} strokeWidth={1.5} />
              </div>
              This transaction no longer exists — it may have been deleted.
            </div>
            <button
              className="btn secondary"
              onClick={() => navigate("/history")}
            >
              Back to history
            </button>
          </div>
        </div>
      </>
    );
  }

  const isIncome = t.type === "income";

  return (
    <>
      <header
        className="topbar"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className="icon-btn"
            aria-label="Back"
            onClick={() => navigate("/history")}
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <div className="eyebrow">Transaction</div>
            <h1 style={{ fontSize: 20 }}>
              {isIncome ? "Income" : "Expense"} details
            </h1>
          </div>
        </div>
        <button
          className="icon-btn"
          aria-label="Edit transaction"
          onClick={() => navigate(`/add?edit=${t.id}`)}
        >
          <Pencil size={18} />
        </button>
      </header>

      <div className="content">
        <div className="card" style={{ textAlign: "center" }}>
          <div
            className="tx-icon"
            style={{
              width: 56,
              height: 56,
              borderRadius: 17,
              fontSize: 24,
              margin: "0 auto 14px",
              ...iconBadgeStyle(category?.color),
            }}
          >
            {category?.icon || "＊"}
          </div>
          <div className={"detail-amount" + (isIncome ? " income" : "")}>
            {isIncome ? "+" : "−"}
            {fmtMoney(t.amount, currency)}
          </div>
          <div className="detail-category">
            {category?.name || "Uncategorized"}
          </div>
        </div>

        <div className="card">
          <h2>Details</h2>
          <div className="detail-row">
            <span className="detail-label">Date: </span>
            <span className="detail-value">{longDate(t.date)}</span>
          </div>
          {t.merchant && (
            <div className="detail-row">
              <span className="detail-label">Merchant</span>
              <span className="detail-value">{t.merchant}</span>
            </div>
          )}
          {t.paymentMethod && (
            <div className="detail-row">
              <span className="detail-label">Payment method: </span>
              <span className="detail-value">{t.paymentMethod}</span>
            </div>
          )}
          {t.note && (
            <div className="detail-row">
              <span className="detail-label">Note: </span>
              <span className="detail-value">{t.note}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">Logged: </span>
            <span className="detail-value">{fmtDateTime(t.createdAt)}</span>
          </div>
        </div>

        {recurring && (
          <div className="card">
            <h2>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
              >
                <Repeat size={15} /> Recurring:
              </span>
            </h2>
            <div className="muted">
              Auto-posted from "{recurring.name}" — {recurring.frequency}
              {recurring.paused ? " · paused" : ""}.
            </div>
          </div>
        )}

        <button
          className="btn secondary"
          onClick={() => navigate(`/add?edit=${t.id}`)}
        >
          Edit transaction
        </button>
        <button className="btn danger" onClick={handleDelete}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              justifyContent: "center",
            }}
          >
            <Trash2 size={15} /> Delete transaction
          </span>
        </button>
      </div>
    </>
  );
}
