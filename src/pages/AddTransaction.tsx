import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "react-router-dom";
import { db, type TxType } from "../db/db";
import { todayISO } from "../lib/format";
import { useUIStore } from "../store/useUIStore";

const RECENT_CAT_KEY = "pfos_last_category"; // suffixed per type, e.g. `${RECENT_CAT_KEY}_expense`

export default function AddTransaction() {
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);
  const allCategories = useLiveQuery(() => db.categories.toArray(), []) ?? [];

  const [type, setType] = useState<TxType>("expense");
  // Income and expense are structurally different concepts — a budget category
  // like "Food" makes no sense for a salary deposit, so they get separate lists
  // rather than sharing one (see Settings → Income sources for how these are managed).
  const categories = allCategories.filter((c) =>
    type === "income" ? c.type === "income" : c.type !== "income",
  );

  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("UPI");
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (categories.length === 0) {
      setCategoryId(null);
      return;
    }
    const last = localStorage.getItem(`${RECENT_CAT_KEY}_${type}`);
    const found = last && categories.find((c) => c.id === Number(last));
    setCategoryId(found ? found.id! : categories[0].id!);
  }, [type, categories.length]);

  async function save(addAnother: boolean) {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      showToast("Enter an amount greater than 0.");
      return;
    }
    if (!categoryId) {
      showToast(
        type === "income"
          ? "Add an income source first."
          : "Pick a category first.",
      );
      return;
    }
    setSaving(true);
    await db.transactions.add({
      type,
      amount: amt,
      categoryId,
      date,
      merchant: merchant.trim() || undefined,
      note: note.trim() || undefined,
      paymentMethod,
      createdAt: Date.now(),
    });
    localStorage.setItem(`${RECENT_CAT_KEY}_${type}`, String(categoryId));
    setSaving(false);
    showToast(
      `Added ${amount} to ${categories.find((c) => c.id === categoryId)?.name || ""}.`,
    );
    if (addAnother) {
      setAmount("");
      setNote("");
      setMerchant("");
    } else {
      navigate("/");
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Log it</div>
        <h1>Add transaction</h1>
        <div className="sub">Takes about five seconds</div>
      </header>
      <div className="content">
        <div className="card">
          <div className="chip-row" style={{ marginBottom: 4 }}>
            <button
              className={"chip" + (type === "expense" ? " active" : "")}
              onClick={() => setType("expense")}
            >
              Expense
            </button>
            <button
              className={"chip" + (type === "income" ? " active" : "")}
              onClick={() => setType("income")}
            >
              Income
            </button>
          </div>

          <label htmlFor="amt">Amount</label>
          <input
            id="amt"
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onWheel={(e) => e.currentTarget.blur()}
          />

          {categories.length === 0 ? (
            <div className="empty" style={{ padding: "20px 8px" }}>
              No income sources set up yet.
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn secondary"
                  onClick={() => navigate("/settings")}
                >
                  Add one in Settings
                </button>
              </div>
            </div>
          ) : (
            <>
              <label htmlFor="cat">
                {type === "income" ? "Source" : "Category"}
              </label>
              <select
                id="cat"
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(Number(e.target.value))}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>

              <div className="chip-row">
                {categories.slice(0, 5).map((c) => (
                  <button
                    key={c.id}
                    className={"chip" + (categoryId === c.id ? " active" : "")}
                    onClick={() => setCategoryId(c.id!)}
                  >
                    {c.icon} {c.name}
                  </button>
                ))}
              </div>
            </>
          )}

          <label htmlFor="date">Date</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          {!advanced ? (
            <button className="btn ghost" onClick={() => setAdvanced(true)}>
              + Merchant, note, payment method
            </button>
          ) : (
            <>
              <label htmlFor="merchant">Merchant</label>
              <input
                id="merchant"
                type="text"
                placeholder="e.g. Zomato"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
              />
              <label htmlFor="note">Note</label>
              <input
                id="note"
                type="text"
                placeholder="Optional note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <label htmlFor="pm">Payment method</label>
              <select
                id="pm"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                {[
                  "UPI",
                  "Cash",
                  "Credit Card",
                  "Debit Card",
                  "Wallet",
                  "Bank Transfer",
                ].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </>
          )}

          <button
            className="btn"
            disabled={saving || categories.length === 0}
            onClick={() => save(false)}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            className="btn secondary"
            disabled={saving || categories.length === 0}
            onClick={() => save(true)}
          >
            Save &amp; add another
          </button>
        </div>
      </div>
    </>
  );
}
