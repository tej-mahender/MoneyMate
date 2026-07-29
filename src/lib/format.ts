export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function fmtMoney(n: number, currency: string): string {
  const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
  const sign = rounded < 0 ? '-' : '';
  return sign + currency + Math.abs(rounded).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function monthLabel(key: string): string {
  const d = new Date(key + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function dayOfMonthProgress(key: string): number {
  const today = new Date();
  const cur = monthKey(todayISO());
  if (key !== cur) return daysInMonth(key); // past month = fully elapsed
  return today.getDate();
}
