import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, type TxType } from '../db/db';
import { todayISO } from '../lib/format';
import { useUIStore } from '../store/useUIStore';

const RECENT_CAT_KEY = 'pfos_last_category';

export default function AddTransaction() {
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);
  const categories = useLiveQuery(() => db.categories.toArray(), []) ?? [];

  const [type, setType] = useState<TxType>('expense');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (categories.length === 0) return;
    const last = localStorage.getItem(RECENT_CAT_KEY);
    const found = last && categories.find((c) => c.id === Number(last));
    setCategoryId(found ? found.id! : categories[0].id!);
  }, [categories.length]);

  async function save(addAnother: boolean) {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { showToast('Enter an amount greater than 0.'); return; }
    if (!categoryId) { showToast('Pick a category first.'); return; }
    setSaving(true);
    await db.transactions.add({
      type, amount: amt, categoryId, date,
      merchant: merchant.trim() || undefined,
      note: note.trim() || undefined,
      paymentMethod,
      createdAt: Date.now(),
    });
    localStorage.setItem(RECENT_CAT_KEY, String(categoryId));
    setSaving(false);
    showToast(`Added ${amount} to ${categories.find((c) => c.id === categoryId)?.name || ''}.`);
    if (addAnother) {
      setAmount(''); setNote(''); setMerchant('');
    } else {
      navigate('/');
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
            <button className={'chip' + (type === 'expense' ? ' active' : '')} onClick={() => setType('expense')}>Expense</button>
            <button className={'chip' + (type === 'income' ? ' active' : '')} onClick={() => setType('income')}>Income</button>
          </div>

          <label htmlFor="amt">Amount</label>
          <input id="amt" type="number" inputMode="decimal" placeholder="0.00" autoFocus
            value={amount} onChange={(e) => setAmount(e.target.value)} />

          <label htmlFor="cat">Category</label>
          <select id="cat" value={categoryId ?? ''} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>

          {categories.length > 0 && (
            <div className="chip-row">
              {categories.slice(0, 5).map((c) => (
                <button key={c.id} className={'chip' + (categoryId === c.id ? ' active' : '')} onClick={() => setCategoryId(c.id!)}>
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
          )}

          <label htmlFor="date">Date</label>
          <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

          {!advanced ? (
            <button className="btn ghost" onClick={() => setAdvanced(true)}>+ Merchant, note, payment method</button>
          ) : (
            <>
              <label htmlFor="merchant">Merchant</label>
              <input id="merchant" type="text" placeholder="e.g. Zomato" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
              <label htmlFor="note">Note</label>
              <input id="note" type="text" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
              <label htmlFor="pm">Payment method</label>
              <select id="pm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                {['UPI', 'Cash', 'Credit Card', 'Debit Card', 'Wallet', 'Bank Transfer'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </>
          )}

          <button className="btn" disabled={saving} onClick={() => save(false)}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="btn secondary" disabled={saving} onClick={() => save(true)}>Save &amp; add another</button>
        </div>
      </div>
    </>
  );
}
