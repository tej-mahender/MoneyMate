import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import BracketDetail from './BracketDetail';
import { db } from '../db/db';

beforeEach(async () => {
  await db.transactions.clear();
  await db.recurring.clear();
  await db.categories.clear();
  await db.brackets.clear();
  await db.settings.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderBracket(id: number) {
  return render(
    <MemoryRouter initialEntries={[`/bracket/${id}`]}>
      <Routes>
        <Route path="/bracket/:id" element={<BracketDetail currency="₹" monthlyIncome={0} />} />
        <Route path="/settings" element={<div>Settings screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function makeBracket(name: string, kind: 'spend' | 'allocation' | 'income' = 'allocation') {
  return db.brackets.add({ name, icon: '💰', color: '#4FD9B8', kind });
}

describe('BracketDetail — archive/delete a bracket', () => {
  it('archiving an empty bracket sets archived=true and navigates back to Settings, with no confirm prompt needed', async () => {
    const id = await makeBracket('Unused Bracket');
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Archive bracket'));

    const bracket = await db.brackets.get(id);
    expect(bracket?.archived).toBe(true);
    expect(await screen.findByText('Settings screen')).toBeInTheDocument();
  });

  it('deleting an empty bracket, confirmed, removes it entirely', async () => {
    const id = await makeBracket('Unused Bracket');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Delete bracket'));

    await waitFor(async () => expect(await db.brackets.get(id)).toBeUndefined());
    expect(await screen.findByText('Settings screen')).toBeInTheDocument();
  });

  it('deleting an empty bracket, cancelled at the confirm, leaves it untouched', async () => {
    const id = await makeBracket('Unused Bracket');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Delete bracket'));

    expect(await db.brackets.get(id)).toBeDefined();
  });

  it('a bracket with categories: declining the delete-confirm falls back to archiving (bracket AND its categories survive, just hidden)', async () => {
    const id = await makeBracket('Savings');
    const catId = await db.categories.add({ name: 'Emergency Fund', icon: '💰', color: '#4FD9B8', budget: 5000, bracketId: id });
    vi.spyOn(window, 'confirm').mockReturnValue(false); // "Cancel" on the delete-or-archive prompt
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Delete bracket'));

    const bracket = await db.brackets.get(id);
    expect(bracket?.archived).toBe(true);
    // Archiving never touches the categories themselves.
    expect(await db.categories.get(catId)).toBeDefined();
  });

  it('a bracket with categories and transactions: confirming the delete cascades to its categories, leaving their transactions pointing at a now-deleted category (shown as Uncategorized elsewhere in the app)', async () => {
    const id = await makeBracket('Savings');
    const catId = await db.categories.add({ name: 'Emergency Fund', icon: '💰', color: '#4FD9B8', budget: 5000, bracketId: id });
    await db.transactions.add({ type: 'expense', amount: 1000, categoryId: catId, date: '2026-08-05', createdAt: Date.now() });
    vi.spyOn(window, 'confirm').mockReturnValue(true); // "OK, delete everything"
    const user = userEvent.setup();
    renderBracket(id);

    await user.click(await screen.findByText('Delete bracket'));

    await waitFor(async () => expect(await db.brackets.get(id)).toBeUndefined());
    expect(await db.categories.get(catId)).toBeUndefined();
    // The transaction itself is never deleted — only its category link goes stale.
    const tx = await db.transactions.toArray();
    expect(tx).toHaveLength(1);
    expect(tx[0].categoryId).toBe(catId);
  });
});
