import { useState } from 'react';
import { db, DEFAULT_CATEGORIES, updateSettings } from '../db/db';
import { Sparkles, X } from 'lucide-react';
import IconPicker from '../components/IconPicker';

const CURRENCIES = ['₹', '$', '€', '£'];

type DraftCat = { name: string; icon: string; color: string; budget: string };

const PALETTE = ['#F0B94D', '#4FD9B8', '#7C93F0', '#E8618C', '#B98CF0', '#F0A83E', '#FF6B6B', '#6FC98A'];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState('₹');
  const [income, setIncome] = useState('');
  const [cats, setCats] = useState<DraftCat[]>(
    DEFAULT_CATEGORIES.map((c) => ({ name: c.name, icon: c.icon, color: c.color, budget: '' }))
  );
  const [saving, setSaving] = useState(false);

  function updateCat(i: number, field: keyof DraftCat, val: string) {
    setCats((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  }
  function addCat() {
    setCats((prev) => [...prev, { name: '', icon: '＊', color: PALETTE[prev.length % PALETTE.length], budget: '' }]);
  }
  function removeCat(i: number) {
    setCats((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function finish() {
    const clean = cats
      .map((c) => ({ name: c.name.trim(), icon: c.icon || '＊', color: c.color, budget: parseFloat(c.budget) || 0 }))
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

  return (
    <div className="app-shell">
      <div className="content">
        {step === 0 && (
          <div className="onboard-hero">
            <div
              className="glyph"
              style={{
                width: 72,
                height: 72,
                borderRadius: 22,
                background: "var(--aurum)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                boxShadow: "var(--shadow-glow-gold)",
              }}
            >
              <Sparkles size={32} color="#1A1206" strokeWidth={2} />
            </div>
            <h1>Welcome to MoneyMate</h1>
            <p>
              A private place to track every rupee — no login, no cloud, no ads,
              no analytics. Everything you enter stays on this device, in this
              browser, forever under your control.
            </p>
            <div className="onboard-steps">
              <span className="active" />
              <span />
              <span />
            </div>
            <button className="btn" onClick={() => setStep(1)}>
              Get started
            </button>
          </div>
        )}

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
