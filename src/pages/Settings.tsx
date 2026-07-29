import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category, type Recurring, type Frequency, updateSettings, type Settings as SettingsType } from '../db/db';
import { exportFullBackup, exportTransactionsCSV, importFullBackup, downloadFile } from '../lib/csv';
import { todayISO } from '../lib/format';
import { useUIStore } from '../store/useUIStore';

const PALETTE = ['#A9782F', '#3E6B4F', '#3D6B8A', '#B4791E', '#8A4A6B', '#6B4A8A', '#A13E3E', '#2F6E5C'];

export default function Settings({ settings, onSettingsChange }: { settings: SettingsType; onSettingsChange: (s: SettingsType) => void }) {
  const showToast = useUIStore((s) => s.showToast);
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];
  const recurring = useLiveQuery(() => db.recurring.toArray(), []) ?? [];

  const [draftCats, setDraftCats] = useState<Category[]>([]);
  useEffect(() => setDraftCats(categories), [categories.length, JSON.stringify(categories.map((c) => c.id))]);

  function updateCat(i: number, field: keyof Category, val: string | number) {
    setDraftCats((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  }
  function addCat() {
    setDraftCats((prev) => [...prev, { name: '', icon: '＊', color: PALETTE[prev.length % PALETTE.length], budget: 0 }]);
  }
  async function removeCat(i: number) {
    const cat = draftCats[i];
    if (cat.id) await db.categories.delete(cat.id);
    setDraftCats((prev) => prev.filter((_, idx) => idx !== i));
  }
  async function saveCats() {
    for (const c of draftCats) {
      if (!c.name.trim()) continue;
      if (c.id) await db.categories.update(c.id, { name: c.name.trim(), budget: Number(c.budget) || 0, icon: c.icon, color: c.color });
      else await db.categories.add({ name: c.name.trim(), budget: Number(c.budget) || 0, icon: c.icon, color: c.color });
    }
    showToast('Budgets saved.');
  }

  // Recurring
  const [rName, setRName] = useState('');
  const [rAmount, setRAmount] = useState('');
  const [rCat, setRCat] = useState<number | null>(null);
  const [rFreq, setRFreq] = useState<Frequency>('monthly');
  const [rType, setRType] = useState<'expense' | 'income'>('expense');

  async function addRecurring() {
    const amt = parseFloat(rAmount);
    if (!rName.trim() || !amt || !rCat) { showToast('Fill in name, amount, and category.'); return; }
    await db.recurring.add({
      name: rName.trim(), amount: amt, categoryId: rCat, frequency: rFreq, type: rType,
      startDate: todayISO(), nextDate: todayISO(),
    });
    setRName(''); setRAmount('');
    showToast('Recurring item added — it will post automatically.');
  }
  async function togglePause(r: Recurring) {
    await db.recurring.update(r.id!, { paused: !r.paused });
  }
  async function deleteRecurring(id: number) {
    await db.recurring.delete(id);
  }

  // Preferences
  async function setCurrency(c: string) {
    const next = await updateSettings({ currency: c });
    onSettingsChange(next);
  }
  async function setTheme(t: SettingsType['theme']) {
    const next = await updateSettings({ theme: t });
    onSettingsChange(next);
  }

  // Data management
  async function doExportJSON() {
    downloadFile(`pfos-backup-${todayISO()}.json`, await exportFullBackup(), 'application/json');
  }
  async function doExportCSV() {
    downloadFile(`pfos-transactions-${todayISO()}.csv`, await exportTransactionsCSV(), 'text/csv');
  }
  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      await importFullBackup(text);
      showToast('Backup restored.');
      const s = await updateSettings({});
      onSettingsChange(s);
    } catch {
      showToast("That file doesn't look like a valid backup.");
    }
    e.target.value = '';
  }
  async function wipeAll() {
    if (!confirm("This deletes every category, transaction, and recurring item on this device. This can't be undone. Continue?")) return;
    await db.transaction('rw', db.categories, db.transactions, db.recurring, db.settings, async () => {
      await db.categories.clear();
      await db.transactions.clear();
      await db.recurring.clear();
      await db.settings.clear();
    });
    location.reload();
  }

  return (
    <>
      <header className="topbar">
        <div className="eyebrow">Settings</div>
        <h1>Preferences &amp; data</h1>
      </header>
      <div className="content">
        <div className="card">
          <h2>Categories &amp; budgets</h2>
          {draftCats.map((c, i) => (
            <div className="cat-edit-row" key={c.id ?? 'new-' + i}>
              <div className="swatch" style={{ background: c.color + '33', color: c.color }}>{c.icon}</div>
              <input type="text" placeholder="Category" value={c.name} onChange={(e) => updateCat(i, 'name', e.target.value)} />
              <input type="number" placeholder="Budget" value={c.budget} onChange={(e) => updateCat(i, 'budget', e.target.value)} />
              <button className="icon-btn danger" aria-label="Remove" onClick={() => removeCat(i)}>✕</button>
            </div>
          ))}
          <button className="btn secondary" onClick={addCat}>+ Add category</button>
          <button className="btn" onClick={saveCats}>Save changes</button>
        </div>

        <div className="card">
          <h2>Recurring transactions</h2>
          {recurring.length === 0 ? (
            <div className="muted" style={{ marginBottom: 12 }}>None yet — rent, subscriptions, salary, EMIs all post automatically once added.</div>
          ) : (
            recurring.map((r) => {
              const c = categories.find((cat) => cat.id === r.categoryId);
              return (
                <div className="tx" key={r.id}>
                  <div className="tx-left">
                    <div className="tx-icon" style={{ background: (c?.color || '#888') + '26', color: c?.color }}>{c?.icon || '＊'}</div>
                    <div className="tx-meta">
                      <div className="tx-cat">{r.name}</div>
                      <div className="tx-note">{r.frequency} · next {r.nextDate}{r.paused ? ' · paused' : ''}</div>
                    </div>
                  </div>
                  <div className="tx-right">
                    <button className="btn small secondary" onClick={() => togglePause(r)}>{r.paused ? 'Resume' : 'Pause'}</button>
                    <button className="icon-btn danger" onClick={() => deleteRecurring(r.id!)}>✕</button>
                  </div>
                </div>
              );
            })
          )}
          <label>Name</label>
          <input type="text" placeholder="e.g. Rent, Netflix, Salary" value={rName} onChange={(e) => setRName(e.target.value)} />
          <div className="row2">
            <div>
              <label>Amount</label>
              <input type="number" value={rAmount} onChange={(e) => setRAmount(e.target.value)} />
            </div>
            <div>
              <label>Frequency</label>
              <select value={rFreq} onChange={(e) => setRFreq(e.target.value as Frequency)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          <div className="row2">
            <div>
              <label>Category</label>
              <select value={rCat ?? ''} onChange={(e) => setRCat(Number(e.target.value))}>
                <option value="">Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label>Type</label>
              <select value={rType} onChange={(e) => setRType(e.target.value as 'expense' | 'income')}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>
          </div>
          <button className="btn secondary" onClick={addRecurring}>+ Add recurring item</button>
        </div>

        <div className="card">
          <h2>Preferences</h2>
          <label>Currency</label>
          <div className="chip-row">
            {['₹', '$', '€', '£'].map((c) => (
              <button key={c} className={'chip' + (settings.currency === c ? ' active' : '')} onClick={() => setCurrency(c)}>{c}</button>
            ))}
          </div>
          <label>Theme</label>
          <div className="chip-row">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <button key={t} className={'chip' + (settings.theme === t ? ' active' : '')} onClick={() => setTheme(t)}>{t}</button>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Your data</h2>
          <p className="muted">Stored only in this browser, on this device. Nothing is ever sent to a server — export a backup regularly so you don't lose history if you clear browser data or switch devices.</p>
          <button className="btn secondary" onClick={doExportJSON}>Export backup (.json)</button>
          <button className="btn secondary" onClick={doExportCSV}>Export transactions (.csv — Power BI ready)</button>
          <label htmlFor="import-file">Restore from backup</label>
          <input id="import-file" type="file" accept="application/json" onChange={onImport} />
          <button className="btn danger" onClick={wipeAll}>Erase all data</button>
        </div>

        <div className="card">
          <h2>About</h2>
          <p className="muted">Personal Finance OS — zero login, zero ads, zero subscription, zero analytics, zero tracking. Installable to your home screen and fully usable offline.</p>
        </div>
      </div>
    </>
  );
}
