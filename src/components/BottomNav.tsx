import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutGrid, History as HistoryIcon, PieChart, Settings as SettingsIcon, Plus } from 'lucide-react';

const tabs = [
  { to: '/', label: 'Home', end: true, Icon: LayoutGrid },
  { to: '/history', label: 'History', Icon: HistoryIcon },
  { to: '/analytics', label: 'Insights', Icon: PieChart },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeIndex = tabs.findIndex((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)));

  return (
    <>
      <motion.button
        className="fab"
        aria-label="Add transaction"
        onClick={() => navigate('/add')}
        whileTap={{ scale: 0.88 }}
      >
        <Plus size={26} strokeWidth={2.5} />
      </motion.button>

      <nav className="bottom-nav">
        {tabs.map((t, i) => {
          const isActive = i === activeIndex;
          const { Icon } = t;
          return (
            <NavLink key={t.to} to={t.to} end={t.end} className={'nav-item' + (isActive ? ' active' : '')}>
              {isActive && (
                <motion.div
                  className="nav-pill"
                  layoutId="nav-pill"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="nav-icon">
                <Icon size={19} strokeWidth={isActive ? 2.4 : 2} />
              </span>
              {/* <span style={{ position: 'relative', zIndex: 1 }}>{t.label}</span> */}
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}
