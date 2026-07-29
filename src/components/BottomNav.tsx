import { NavLink, useNavigate } from 'react-router-dom';

const tabs = [
  { to: '/', glyph: '▤', label: 'Overview', end: true },
  { to: '/history', glyph: '≡', label: 'History' },
  { to: '/analytics', glyph: '◔', label: 'Insights' },
  { to: '/settings', glyph: '⚙', label: 'Settings' },
];

export default function BottomNav() {
  const navigate = useNavigate();
  return (
    <>
      <button className="fab" aria-label="Add transaction" onClick={() => navigate('/add')}>+</button>
      <nav className="bottom-nav">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="glyph">{t.glyph}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
