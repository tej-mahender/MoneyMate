import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { getSettings, processRecurring, type Settings as SettingsType } from './db/db';
import { todayISO } from './lib/format';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import AddTransaction from './pages/AddTransaction';
import History from './pages/History';
import Analytics from './pages/Analytics';
import SettingsPage from './pages/Settings';
import BottomNav from './components/BottomNav';
import Toast from './components/Toast';

function AnimatedRoutes({ settings, onSettingsChange }: { settings: SettingsType; onSettingsChange: (s: SettingsType) => void }) {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <Routes location={location}>
          <Route path="/" element={<Dashboard currency={settings.currency} />} />
          <Route path="/add" element={<AddTransaction />} />
          <Route path="/history" element={<History currency={settings.currency} />} />
          <Route path="/analytics" element={<Analytics currency={settings.currency} />} />
          <Route path="/settings" element={<SettingsPage settings={settings} onSettingsChange={onSettingsChange} />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      await processRecurring(todayISO());
      const s = await getSettings();
      setSettings(s);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const applied = settings.theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : settings.theme;
    root.setAttribute('data-theme', applied);
  }, [settings?.theme]);

  if (loading || !settings) {
    return (
      <div className="app-shell">
        <div className="content" style={{ paddingTop: 60 }}>
          <div className="skeleton" style={{ height: 96, marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 170, marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 230 }} />
        </div>
      </div>
    );
  }

  if (!settings.onboarded) {
    return <Onboarding onDone={async () => setSettings(await getSettings())} />;
  }

  return (
    <HashRouter>
      <div className="app-shell">
        <AnimatedRoutes settings={settings} onSettingsChange={setSettings} />
        <BottomNav />
        <Toast />
      </div>
    </HashRouter>
  );
}
