import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CategoryRow from './CategoryRow';
import type { Category } from '../db/db';

const baseCategory: Category = { id: 1, name: 'Rent', icon: '🏠', color: '#F0B94D', budget: 0, bracketId: 1 };

describe('CategoryRow — empty state', () => {
  it('shows "Not budgeted yet" and nothing else when both budget and spend are zero', () => {
    render(<CategoryRow category={baseCategory} spent={0} currency="₹" />);
    expect(screen.getByText('Not budgeted yet')).toBeInTheDocument();
    expect(screen.queryByText(/% used/)).not.toBeInTheDocument();
    expect(screen.queryByText('unbudgeted')).not.toBeInTheDocument();
  });

  it('shows figures instead of "Not budgeted yet" once a real budget exists, even with nothing spent', () => {
    render(<CategoryRow category={{ ...baseCategory, budget: 20000 }} spent={0} currency="₹" />);
    expect(screen.queryByText('Not budgeted yet')).not.toBeInTheDocument();
    expect(screen.getByText('0% used')).toBeInTheDocument();
  });

  it('shows figures instead of "Not budgeted yet" once there\'s real spend, even with no budget set', () => {
    render(<CategoryRow category={baseCategory} spent={500} currency="₹" />);
    expect(screen.queryByText('Not budgeted yet')).not.toBeInTheDocument();
    expect(screen.getByText('unbudgeted')).toBeInTheDocument();
  });
});

describe('CategoryRow — spend vs. allocation semantics', () => {
  it('spend kind (default): exceeding 100% reads "over" in the bad/red sense', () => {
    render(<CategoryRow category={{ ...baseCategory, budget: 10000 }} spent={12000} currency="₹" />);
    const tag = screen.getByText(/120% used/);
    expect(tag).toHaveTextContent('over by ₹2,000');
    expect(tag).toHaveStyle({ color: 'var(--over)' });
  });

  it('allocation kind: exceeding 100% reads "reached" positively, not "over"', () => {
    render(
      <CategoryRow category={{ ...baseCategory, budget: 10000 }} spent={12000} currency="₹" isAllocation />,
    );
    const tag = screen.getByText(/120% reached/);
    expect(tag).toHaveTextContent('exceeded by ₹2,000');
    expect(tag.style.color).not.toBe('var(--over)');
  });
});

describe('CategoryRow — interaction', () => {
  it('calls onClick when the row is tapped', async () => {
    let clicked = false;
    render(
      <CategoryRow
        category={{ ...baseCategory, budget: 5000 }}
        spent={1000}
        currency="₹"
        onClick={() => {
          clicked = true;
        }}
      />,
    );
    screen.getByText('Rent').closest('.cat-row')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe(true);
  });
});
