import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db, type TxType, type SplitShare } from "../db/db";
import { todayISO } from "../lib/format";
import { useUIStore } from "../store/useUIStore";
import Dropdown from "../components/Dropdown";
import { X, Users } from "lucide-react";

const RECENT_CAT_KEY = "pfos_last_category"; // suffixed per type, e.g. `${RECENT_CAT_KEY}_expense`

interface SplitPersonDraft {
  name: string;
  amount: string;
}

/** Splits `total` evenly across the given number of *other* people plus
 *  yourself, folding any rounding remainder into your own share so the
 *  numbers always sum to exactly `total` — never off by a paisa because
 *  of division. */
function evenSplit(
  total: number,
  otherCount: number,
): { yours: number; each: number } {
  const parties = otherCount + 1;
  if (parties <= 1 || total <= 0) return { yours: total, each: 0 };
  const each = Math.floor((total / parties) * 100) / 100;
  const yours = Math.round((total - each * otherCount) * 100) / 100;
  return { yours, each };
}

export default function AddTransaction() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit")
    ? Number(searchParams.get("edit"))
    : null;
  const editingTx = useLiveQuery(
    () => (editId ? db.transactions.get(editId) : undefined),
    [editId],
  );
  const showToast = useUIStore((s) => s.showToast);
  const allCategories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const allBrackets = useLiveQuery(() => db.brackets.toArray(), []) ?? [];
  const bracketKindById = new Map(allBrackets.map((b) => [b.id, b.kind]));
  const bracketById = new Map(allBrackets.map((b) => [b.id, b]));

  const [type, setType] = useState<TxType>("expense");
  // Income and expense are structurally different concepts — a budget category
  // like "Food" makes no sense for a salary deposit, so they get separate lists
  // rather than sharing one (see Settings → Income sources for how these are managed).
  const categories = allCategories.filter((c) => {
    const bracket = bracketById.get(c.bracketId);
    if (!bracket || bracket.archived) return false; // hidden bracket, or an orphaned category with no bracket at all
    return type === "income"
      ? bracket.kind === "income"
      : bracket.kind !== "income";
  });

  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("UPI");
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  // Splitting only applies to expenses — logging income never needs it.
  // `amount` above is the TOTAL you actually paid once split is on; your
  // own share is derived (total minus everyone else's), never typed
  // directly, so it can never silently drift out of sync with the people
  // list. Existing split shares (if editing a past split) are matched back
  // onto these draft rows by name when saving, so a partial repayment a
  // friend already made isn't lost just because you corrected an amount.
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitPeople, setSplitPeople] = useState<SplitPersonDraft[]>([]);
  const existingShares = useLiveQuery(
    () =>
      editId
        ? db.splitShares.where("transactionId").equals(editId).toArray()
        : Promise.resolve<SplitShare[]>([]),
    [editId],
  );
  const knownNames = useLiveQuery(() => db.splitShares.toArray(), []);
  const nameSuggestions = [
    ...new Set(
      (knownNames ?? [])
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => s.personName),
    ),
  ].slice(0, 8);

  // One-time prefill once the transaction being edited has loaded — after
  // that the fields are just normal controlled state the user can change.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!editingTx || prefilled.current) return;
    // In edit mode, existingShares is a second, independent live query —
    // wait for it to actually resolve (even to an empty array) before
    // prefilling, since it could resolve after editingTx does. Locking in
    // prefilled.current before that would silently skip loading split data.
    if (editId && existingShares === undefined) return;
    prefilled.current = true;
    setType(editingTx.type);
    setCategoryId(editingTx.categoryId);
    setDate(editingTx.date);
    setMerchant(editingTx.merchant || "");
    setNote(editingTx.note || "");
    setPaymentMethod(editingTx.paymentMethod || "UPI");
    if (editingTx.merchant || editingTx.note) setAdvanced(true);

    if (existingShares && existingShares.length > 0) {
      // The transaction only ever stored your own share — reconstruct the
      // original total (what actually left your hand) for the form.
      const othersTotal = existingShares.reduce(
        (s, sh) => s + sh.amountOwed,
        0,
      );
      setAmount(String(editingTx.amount + othersTotal));
      setSplitEnabled(true);
      setSplitPeople(
        existingShares.map((sh) => ({
          name: sh.personName,
          amount: String(sh.amountOwed),
        })),
      );
    } else {
      setAmount(String(editingTx.amount));
    }
  }, [editingTx, existingShares, editId]);

  useEffect(() => {
    // In edit mode the category comes from the transaction being edited
    // (handled by the prefill effect above), not from "last used" —
    // otherwise this would stomp the loaded category the moment the type
    // resolves.
    if (editId) return;
    if (categories.length === 0) {
      setCategoryId(null);
      return;
    }
    const last = localStorage.getItem(`${RECENT_CAT_KEY}_${type}`);
    const found = last && categories.find((c) => c.id === Number(last));
    setCategoryId(found ? found.id! : categories[0].id!);
  }, [type, categories.length, editId]);

  // Valid split rows: a real name and a positive amount. Rows with a blank
  // name or empty amount are just in-progress drafts, not real people yet.
  const validSplitPeople = splitPeople
    .map((p) => ({ name: p.name.trim(), amount: parseFloat(p.amount) || 0 }))
    .filter((p) => p.name.length > 0 && p.amount > 0);
  const splitOthersTotal = validSplitPeople.reduce((s, p) => s + p.amount, 0);
  const isSplitting =
    type === "expense" && splitEnabled && validSplitPeople.length > 0;
  const yourShare = isSplitting
    ? (parseFloat(amount) || 0) - splitOthersTotal
    : parseFloat(amount) || 0;

  const [splitManuallyEdited, setSplitManuallyEdited] = useState(false);

  function addSplitPerson() {
    setSplitPeople((prev) => {
      const next = [...prev, { name: "", amount: "" }];
      if (splitManuallyEdited) return next;
      // Auto-divide: rebalance EVERY row together, not just fill in an
      // amount for the newest one — otherwise adding a 3rd person would
      // leave the first two still showing their old 2-way-split amounts,
      // and the row totals would never actually sum to an even split.
      const total = parseFloat(amount) || 0;
      const { each } = evenSplit(total, next.length);
      return next.map((p) => ({ ...p, amount: each > 0 ? String(each) : "" }));
    });
  }
  function removeSplitPerson(i: number) {
    setSplitPeople((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      if (splitManuallyEdited || next.length === 0) return next;
      const total = parseFloat(amount) || 0;
      const { each } = evenSplit(total, next.length);
      return next.map((p) => ({ ...p, amount: each > 0 ? String(each) : "" }));
    });
  }
  function updateSplitPerson(
    i: number,
    field: keyof SplitPersonDraft,
    value: string,
  ) {
    if (field === "amount") setSplitManuallyEdited(true);
    setSplitPeople((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)),
    );
  }

  async function reconcileSplitShares(transactionId: number) {
    const previous = editId ? (existingShares ?? []) : [];
    const previousByName = new Map(
      previous.map((s) => [s.personName.toLowerCase(), s]),
    );
    const keepNames = new Set(
      validSplitPeople.map((p) => p.name.toLowerCase()),
    );

    for (const old of previous) {
      if (!keepNames.has(old.personName.toLowerCase())) {
        await db.splitShares.delete(old.id!);
      }
    }
    for (const p of validSplitPeople) {
      const existing = previousByName.get(p.name.toLowerCase());
      if (existing) {
        // Preserve whatever's already been repaid — editing the split
        // shouldn't erase a friend's partial payment. If the corrected
        // amount is now less than what they've already paid, clamp the
        // settled figure down rather than leave it reading as "paid more
        // than they owed".
        await db.splitShares.update(existing.id!, {
          amountOwed: p.amount,
          amountSettled: Math.min(existing.amountSettled, p.amount),
        });
      } else {
        await db.splitShares.add({
          transactionId,
          personName: p.name,
          amountOwed: p.amount,
          amountSettled: 0,
          createdAt: Date.now(),
        });
      }
    }
  }

  async function save(addAnother: boolean) {
    const totalAmt = parseFloat(amount);
    if (!totalAmt || totalAmt <= 0) {
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
    if (isSplitting && yourShare < 0) {
      showToast("The amounts you've split add up to more than the total.");
      return;
    }
    const amt = isSplitting ? yourShare : totalAmt;
    setSaving(true);

    if (editId) {
      await db.transaction("rw", db.transactions, db.splitShares, async () => {
        await db.transactions.update(editId, {
          type,
          amount: amt,
          categoryId,
          date,
          merchant: merchant.trim() || undefined,
          note: note.trim() || undefined,
          paymentMethod,
        });
        await reconcileSplitShares(editId);
      });
      setSaving(false);
      showToast("Transaction updated.");
      navigate(`/transaction/${editId}`);
      return;
    }

    await db.transaction("rw", db.transactions, db.splitShares, async () => {
      const id = await db.transactions.add({
        type,
        amount: amt,
        categoryId,
        date,
        merchant: merchant.trim() || undefined,
        note: note.trim() || undefined,
        paymentMethod,
        createdAt: Date.now(),
      });
      if (isSplitting) await reconcileSplitShares(id);
    });
    localStorage.setItem(`${RECENT_CAT_KEY}_${type}`, String(categoryId));
    setSaving(false);

    showToast(
      isSplitting
        ? `Added ${amt} to ${categories.find((c) => c.id === categoryId)?.name || ""} — ${splitOthersTotal} split with ${validSplitPeople.length === 1 ? validSplitPeople[0].name : `${validSplitPeople.length} people`}.`
        : `Added ${amount} to ${categories.find((c) => c.id === categoryId)?.name || ""}.`,
    );
    if (addAnother) {
      setAmount("");
      setNote("");
      setMerchant("");
      setSplitEnabled(false);
      setSplitPeople([]);
    } else {
      // Spend-category transactions land on Budget (Rent/Food/etc.) for
      // immediate feedback on the category cap; allocation and income
      // transactions land on Home, since Budget never shows those at all.
      const cat = categories.find((c) => c.id === categoryId);
      const kind = cat ? bracketKindById.get(cat.bracketId) : undefined;
      navigate(kind === "spend" ? "/budget" : "/");
    }
  }

  return (
    <>
      {editId ? (
        <header className="topbar">
          <div className="eyebrow">Editing</div>
          <h1>Edit transaction</h1>
          <div className="sub">Update the details below</div>
        </header>
      ) : (
        <header className="topbar">
          <div className="eyebrow">Log it</div>
          <h1>Add transaction</h1>
          <div className="sub">Takes about five seconds</div>
        </header>
      )}
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

          <label htmlFor="amt">
            {isSplitting ? "Total you paid" : "Amount"}
          </label>
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

          {type === "expense" && (
            <>
              <button
                type="button"
                className={"chip" + (splitEnabled ? " active" : "")}
                aria-pressed={splitEnabled}
                onClick={() => {
                  const turningOn = !splitEnabled;
                  setSplitEnabled(turningOn);
                  if (turningOn && splitPeople.length === 0) addSplitPerson();
                  if (!turningOn) {
                    setSplitPeople([]);
                    setSplitManuallyEdited(false);
                  }
                }}
                style={{
                  marginTop: 14,
                  marginBottom: splitEnabled ? 12 : 18,
                  padding: "10px 16px",
                }}
              >
                <Users size={14} />{" "}
                {splitEnabled ? "Splitting this expense" : "Split this expense"}
              </button>

              {splitEnabled && (
                <div
                  className="card"
                  style={{
                    background: "var(--surface-2, rgba(255,255,255,0.03))",
                    padding: 14,
                    marginBottom: 16,
                  }}
                >
                  <div
                    className="muted"
                    style={{ fontSize: 12, marginBottom: 8 }}
                  >
                    Who else was there? Don't add yourself — your own share is
                    worked out automatically below.
                  </div>
                  {splitPeople.map((p, i) => (
                    <div
                      key={i}
                      className="cat-edit-row"
                      style={{ padding: "6px 0" }}
                    >
                      <input
                        type="text"
                        placeholder="Name"
                        list="split-name-suggestions"
                        value={p.name}
                        onChange={(e) =>
                          updateSplitPerson(i, "name", e.target.value)
                        }
                      />
                      <input
                        type="number"
                        placeholder="Amount"
                        inputMode="decimal"
                        value={p.amount}
                        onChange={(e) =>
                          updateSplitPerson(i, "amount", e.target.value)
                        }
                        onWheel={(e) => e.currentTarget.blur()}
                      />
                      <button
                        className="icon-btn danger"
                        aria-label="Remove person"
                        onClick={() => removeSplitPerson(i)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  <datalist id="split-name-suggestions">
                    {nameSuggestions.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                  <button
                    className="btn ghost"
                    style={{ marginTop: 8 }}
                    onClick={addSplitPerson}
                  >
                    + Add person
                  </button>
                  <div
                    className="muted"
                    style={{
                      marginTop: 10,
                      fontSize: 13,
                      color: yourShare < 0 ? "var(--over)" : undefined,
                    }}
                  >
                    Your share of this expense:{" "}
                    <b style={{ fontFamily: "var(--mono)" }}>
                      {Number.isFinite(yourShare)
                        ? yourShare.toFixed(2)
                        : "0.00"}
                    </b>
                    {yourShare < 0 && " — split amounts exceed the total"}
                  </div>
                </div>
              )}
            </>
          )}

          {categories.length === 0 ? (
            <div className="empty" style={{ padding: "20px 8px" }}>
              {type === "income"
                ? "No income sources set up yet."
                : "No categories set up yet."}
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
              <Dropdown
                id="cat"
                value={categoryId != null ? String(categoryId) : ""}
                onChange={(v) => setCategoryId(Number(v))}
                options={categories.map((c) => {
                  const bracket = bracketById.get(c.bracketId);
                  const suffix =
                    bracket && bracket.kind !== "spend"
                      ? ` · ${bracket.name}`
                      : "";
                  return {
                    value: String(c.id),
                    label: `${c.icon} ${c.name}${suffix}`,
                  };
                })}
              />

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
              <Dropdown
                id="pm"
                value={paymentMethod}
                onChange={setPaymentMethod}
                options={[
                  "UPI",
                  "Cash",
                  "Credit Card",
                  "Debit Card",
                  "Wallet",
                  "Bank Transfer",
                ].map((p) => ({ value: p, label: p }))}
              />
            </>
          )}

          <button
            className="btn"
            disabled={saving || categories.length === 0}
            onClick={() => save(false)}
          >
            {saving ? "Saving…" : editId ? "Save changes" : "Save"}
          </button>
          {!editId && (
            <button
              className="btn secondary"
              disabled={saving || categories.length === 0}
              onClick={() => save(true)}
            >
              Save &amp; add another
            </button>
          )}
        </div>
      </div>
    </>
  );
}
