import { useState } from "react";
import { db, DEFAULT_CATEGORIES, updateSettings } from "../db/db";
import { PiggyBank, IndianRupee, CreditCard, X } from "lucide-react";
import IconPicker from "../components/IconPicker";
import moneyMateIcon from "/icons/apple-touch-icon.png";

const CURRENCIES = ["₹", "$", "€", "£"];

type DraftCat = { name: string; icon: string; color: string; budget: string };

const PALETTE = [
  "#F0B94D",
  "#4FD9B8",
  "#7C93F0",
  "#E8618C",
  "#B98CF0",
  "#F0A83E",
  "#FF6B6B",
  "#6FC98A",
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState("₹");
  const [income, setIncome] = useState("");
  const [cats, setCats] = useState<DraftCat[]>(
    DEFAULT_CATEGORIES.map((c) => ({
      name: c.name,
      icon: c.icon,
      color: c.color,
      budget: "",
    })),
  );
  const [saving, setSaving] = useState(false);

  function updateCat(i: number, field: keyof DraftCat, val: string) {
    setCats((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)),
    );
  }
  function addCat() {
    setCats((prev) => [
      ...prev,
      {
        name: "",
        icon: "＊",
        color: PALETTE[prev.length % PALETTE.length],
        budget: "",
      },
    ]);
  }
  function removeCat(i: number) {
    setCats((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function finish() {
    const clean = cats
      .map((c) => ({
        name: c.name.trim(),
        icon: c.icon || "＊",
        color: c.color,
        budget: parseFloat(c.budget) || 0,
      }))
      .filter((c) => c.name.length > 0);
    if (clean.length === 0) return;
    setSaving(true);
    await db.categories.bulkAdd(clean);
    await updateSettings({
      onboarded: true,
      currency,
      monthlyIncome: parseFloat(income) || 0,
    });
    setSaving(false);
    onDone();
  }

  if (step === 0) {
    return (
      <div className="splash-hero">
        <img src={moneyMateIcon} alt="MoneyMate" className="icon-mark" />
        <h1 className="wordmark">
          <span className="money">Money</span>
          <span className="mate">Mate</span>
        </h1>
        <p className="tagline">Track &nbsp;·&nbsp; Plan &nbsp;·&nbsp; Grow</p>
        <p className="pitch">
          Your <b>private</b> finance tracker — no login, no cloud, no ads, no
          analytics. Everything you enter stays on this device, under your
          control, forever.
        </p>
        <div className="trust-icons">
          <div className="ti">
            <PiggyBank size={19} strokeWidth={1.75} />
          </div>
          <div className="ti">
            <IndianRupee size={19} strokeWidth={1.75} />
          </div>
          <div className="ti">
            <CreditCard size={19} strokeWidth={1.75} />
          </div>
        </div>

        <svg
          className="waves"
          viewBox="0 0 500 160"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M0,90 C120,60 180,110 300,80 C380,60 440,95 500,70 L500,160 L0,160 Z"
            fill="rgba(86,242,154,0.10)"
          />
          <path
            d="M0,115 C100,90 220,135 320,105 C400,82 450,120 500,100 L500,160 L0,160 Z"
            fill="rgba(2,145,109,0.16)"
          />
          <path
            d="M0,140 C140,120 260,150 380,125 C430,113 470,135 500,125 L500,160 L0,160 Z"
            fill="rgba(2,145,109,0.28)"
          />
        </svg>

        <div className="cta-wrap">
          <div className="onboard-steps" style={{ marginBottom: 16 }}>
            <span className="active" />
            <span />
            <span />
          </div>
          <button className="btn" onClick={() => setStep(1)}>
            Get started
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="content">
        {step === 1 && (
          <>
            <div className="onboard-hero" style={{ padding: "30px 8px 4px" }}>
              <h1 style={{ fontSize: 21 }}>A little context</h1>
              <p>
                Currency and monthly income — both optional to change later in
                Settings.
              </p>
              <div className="onboard-steps">
                <span />
                <span className="active" />
                <span />
              </div>
            </div>
            <div className="card">
              <h2>Currency</h2>
              <div className="chip-row">
                {CURRENCIES.map((c) => (
                  <button
                    key={c}
                    className={"chip" + (currency === c ? " active" : "")}
                    onClick={() => setCurrency(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <label htmlFor="income">Monthly income (optional)</label>
              <input
                id="income"
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={income}
                onChange={(e) => setIncome(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
              />
              <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                {Number(income) > 0
                  ? "Savings will be tracked automatically each month, alongside your category budgets."
                  : "Leave this blank if you\u2019d rather just track spending against your category budgets — that\u2019s a common way to use this app, and nothing forces you to log income."}
              </p>
              <button className="btn" onClick={() => setStep(2)}>
                Continue
              </button>
              <button className="btn ghost" onClick={() => setStep(0)}>
                Back
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onboard-hero" style={{ padding: "30px 8px 4px" }}>
              <h1 style={{ fontSize: 21 }}>Set your budgets</h1>
              <p>
                Add each category you spend on and a monthly cap. You can change
                these anytime.
              </p>
              <div className="onboard-steps">
                <span />
                <span />
                <span className="active" />
              </div>
            </div>
            <div className="card">
              <h2>Categories</h2>
              {cats.map((c, i) => (
                <div className="cat-edit-row" key={i}>
                  <IconPicker
                    icon={c.icon}
                    color={c.color}
                    palette={PALETTE}
                    onIconChange={(icon) => updateCat(i, "icon", icon)}
                    onColorChange={(color) => updateCat(i, "color", color)}
                  />
                  <input
                    type="text"
                    placeholder="Category"
                    value={c.name}
                    onChange={(e) => updateCat(i, "name", e.target.value)}
                  />
                  <input
                    type="number"
                    placeholder="Budget"
                    value={c.budget}
                    onChange={(e) => updateCat(i, "budget", e.target.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                  <button
                    className="icon-btn danger"
                    onClick={() => removeCat(i)}
                    aria-label="Remove"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button className="btn secondary" onClick={addCat}>
                + Add category
              </button>
              <button className="btn" disabled={saving} onClick={finish}>
                {saving ? "Setting up…" : "Start tracking"}
              </button>
              <button className="btn ghost" onClick={() => setStep(1)}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
