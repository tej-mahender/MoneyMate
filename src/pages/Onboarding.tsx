import { useState } from "react";
import {
  db,
  DEFAULT_CATEGORIES,
  updateSettings,
  ensureIncomeCategoriesSeeded,
} from "../db/db";
import { PiggyBank, IndianRupee, CreditCard, X } from "lucide-react";
import IconPicker from "../components/IconPicker";
import moneyMateIcon from "../assets/moneymate-icon.png";
import moneyMateIconWebp from "../assets/moneymate-icon.webp";

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

/** Shared wave graphic sitting behind all three onboarding steps — kept as one
 *  component so the (fairly large) path data lives in exactly one place rather
 *  than being duplicated per step. */
function OnboardWaves() {
  return (
    <svg
      className="waves"
      viewBox="0 0 500 160"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0,89.0 L5,89.8 L10,90.6 L15,91.4 L20,92.0 L25,92.7 L30,93.3 L35,93.8 L40,94.3 L45,94.7 L50,95.1 L55,95.4 L60,95.6 L65,95.8 L70,95.9 L75,96.0 L80,96.0 L85,95.9 L90,95.8 L95,95.6 L100,95.3 L105,95.0 L110,94.6 L115,94.2 L120,93.7 L125,93.2 L130,92.6 L135,91.9 L140,91.2 L145,90.5 L150,89.7 L155,88.9 L160,88.0 L165,87.1 L170,86.2 L175,85.3 L180,84.3 L185,83.3 L190,82.4 L195,81.4 L200,80.3 L205,79.3 L210,78.3 L215,77.3 L220,76.3 L225,75.4 L230,74.4 L235,73.5 L240,72.6 L245,71.7 L250,70.9 L255,70.0 L260,69.3 L265,68.6 L270,67.9 L275,67.2 L280,66.7 L285,66.1 L290,65.7 L295,65.2 L300,64.9 L305,64.6 L310,64.3 L315,64.2 L320,64.1 L325,64.0 L330,64.0 L335,64.1 L340,64.2 L345,64.4 L350,64.7 L355,65.0 L360,65.4 L365,65.9 L370,66.4 L375,66.9 L380,67.5 L385,68.2 L390,68.9 L395,69.6 L400,70.4 L405,71.2 L410,72.1 L415,73.0 L420,73.9 L425,74.8 L430,75.8 L435,76.8 L440,77.8 L445,78.8 L450,79.8 L455,80.8 L460,81.8 L465,82.8 L470,83.8 L475,84.8 L480,85.7 L485,86.6 L490,87.5 L495,88.4 L500,89.3 L500,160 L0,160 Z"
        fill="rgba(86,242,154,0.10)"
      />
      <path
        d="M0,116.7 L5,115.8 L10,114.8 L15,113.9 L20,112.9 L25,111.9 L30,111.0 L35,110.0 L40,109.0 L45,108.0 L50,107.0 L55,106.1 L60,105.1 L65,104.2 L70,103.2 L75,102.3 L80,101.4 L85,100.6 L90,99.7 L95,98.9 L100,98.1 L105,97.3 L110,96.6 L115,95.9 L120,95.2 L125,94.5 L130,93.9 L135,93.4 L140,92.8 L145,92.4 L150,91.9 L155,91.5 L160,91.2 L165,90.9 L170,90.6 L175,90.4 L180,90.2 L185,90.1 L190,90.0 L195,90.0 L200,90.0 L205,90.1 L210,90.2 L215,90.4 L220,90.6 L225,90.9 L230,91.2 L235,91.5 L240,91.9 L245,92.3 L250,92.8 L255,93.3 L260,93.9 L265,94.5 L270,95.1 L275,95.8 L280,96.5 L285,97.3 L290,98.0 L295,98.8 L300,99.7 L305,100.5 L310,101.4 L315,102.3 L320,103.2 L325,104.1 L330,105.1 L335,106.0 L340,107.0 L345,108.0 L350,108.9 L355,109.9 L360,110.9 L365,111.9 L370,112.8 L375,113.8 L380,114.8 L385,115.7 L390,116.6 L395,117.6 L400,118.5 L405,119.3 L410,120.2 L415,121.0 L420,121.8 L425,122.6 L430,123.3 L435,124.1 L440,124.7 L445,125.4 L450,126.0 L455,126.6 L460,127.1 L465,127.6 L470,128.0 L475,128.4 L480,128.8 L485,129.1 L490,129.4 L495,129.6 L500,129.8 L500,160 L0,160 Z"
        fill="rgba(2,145,109,0.16)"
      />
      <path
        d="M0,122.2 L5,122.4 L10,122.5 L15,122.7 L20,122.9 L25,123.1 L30,123.3 L35,123.6 L40,123.8 L45,124.1 L50,124.5 L55,124.8 L60,125.2 L65,125.5 L70,125.9 L75,126.3 L80,126.8 L85,127.2 L90,127.7 L95,128.2 L100,128.6 L105,129.1 L110,129.7 L115,130.2 L120,130.7 L125,131.3 L130,131.8 L135,132.4 L140,132.9 L145,133.5 L150,134.1 L155,134.6 L160,135.2 L165,135.8 L170,136.4 L175,137.0 L180,137.5 L185,138.1 L190,138.7 L195,139.3 L200,139.8 L205,140.4 L210,140.9 L215,141.5 L220,142.0 L225,142.5 L230,143.0 L235,143.5 L240,144.0 L245,144.5 L250,144.9 L255,145.4 L260,145.8 L265,146.2 L270,146.6 L275,147.0 L280,147.3 L285,147.6 L290,148.0 L295,148.2 L300,148.5 L305,148.8 L310,149.0 L315,149.2 L320,149.4 L325,149.5 L330,149.7 L335,149.8 L340,149.9 L345,149.9 L350,150.0 L355,150.0 L360,150.0 L365,150.0 L370,149.9 L375,149.8 L380,149.7 L385,149.6 L390,149.4 L395,149.3 L400,149.1 L405,148.9 L410,148.6 L415,148.3 L420,148.1 L425,147.8 L430,147.4 L435,147.1 L440,146.7 L445,146.3 L450,145.9 L455,145.5 L460,145.1 L465,144.6 L470,144.2 L475,143.7 L480,143.2 L485,142.7 L490,142.2 L495,141.7 L500,141.1 L500,160 L0,160 Z"
        fill="rgba(2,145,109,0.28)"
      />
    </svg>
  );
}

/** Progress dots — reused with a different active index per step. */
function StepDots({ active }: { active: number }) {
  return (
    <div className="onboard-steps">
      <span className={active === 0 ? "active" : ""} />
      <span className={active === 1 ? "active" : ""} />
      <span className={active === 2 ? "active" : ""} />
    </div>
  );
}

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
        type: "expense" as const,
      }))
      .filter((c) => c.name.length > 0);
    if (clean.length === 0) return;
    setSaving(true);
    await db.categories.bulkAdd(clean);
    const monthlyIncome = parseFloat(income) || 0;
    if (monthlyIncome > 0) await ensureIncomeCategoriesSeeded();
    await updateSettings({
      onboarded: true,
      currency,
      monthlyIncome,
    });
    setSaving(false);
    onDone();
  }

  return (
    <div className="onboard-shell">
      <OnboardWaves />
      <div className="shell-inner">
        {step === 0 && (
          <div className="splash-hero">
            <picture>
              <source srcSet={moneyMateIconWebp} type="image/webp" />
              <picture>
                <source srcSet={moneyMateIconWebp} type="image/webp" />
                <img
                  src={moneyMateIcon}
                  alt="MoneyMate"
                  className="icon-mark"
                />
              </picture>
            </picture>
            <h1 className="wordmark">
              <span className="money">Money</span>
              <span className="mate">Mate</span>
            </h1>
            <p className="tagline">
              Track &nbsp;·&nbsp; Plan &nbsp;·&nbsp; Grow
            </p>
            <p className="pitch">
              Your <b>private</b> finance tracker — no login, no cloud, no ads,
              no analytics. Everything you enter stays on this device, under
              your control, forever.
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
            <div className="cta-wrap">
              <StepDots active={0} />
              <button className="btn" onClick={() => setStep(1)}>
                Get started
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="shell-content">
            <div className="onboard-hero" style={{ padding: "30px 8px 4px" }}>
              <h1 style={{ fontSize: 21 }}>A little context</h1>
              <p>
                Currency and monthly income — both optional to change later in
                Settings.
              </p>
              <StepDots active={1} />
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
          </div>
        )}

        {step === 2 && (
          <div className="shell-content">
            <div className="onboard-hero" style={{ padding: "30px 8px 4px" }}>
              <h1 style={{ fontSize: 21 }}>Set your budgets</h1>
              <p>
                Add each category you spend on and a monthly cap. You can change
                these anytime.
              </p>
              <StepDots active={2} />
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
          </div>
        )}
      </div>
    </div>
  );
}
