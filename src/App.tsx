import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  getSettings,
  processRecurring,
  type Settings as SettingsType,
} from "./db/db";
import { todayISO } from "./lib/format";
import { isQuickAddContext } from "./lib/quickAdd";
import Dashboard from "./pages/Dashboard";
import BottomNav from "./components/BottomNav";
import Toast from "./components/Toast";
import ErrorBoundary from "./components/ErrorBoundary";

// Code-split everything except Dashboard, which is the landing screen on
// every normal launch and should paint immediately with no extra network
// round-trip. The rest — especially Analytics, which alone pulls in the
// recharts dependency — only need to load once the person actually
// navigates there, so they shouldn't cost anything on first paint.
const Onboarding = lazy(() => import("./pages/Onboarding"));
const AddTransaction = lazy(() => import("./pages/AddTransaction"));
const History = lazy(() => import("./pages/History"));
const TransactionDetail = lazy(() => import("./pages/TransactionDetail"));
const Analytics = lazy(() => import("./pages/Analytics"));
const SettingsPage = lazy(() => import("./pages/Settings"));

function RouteFallback() {
  // Mirrors the app-shell's own initial-load skeleton so a lazy chunk
  // fetch (typically well under a second on a cached PWA, but real on a
  // cold load or a slow connection) doesn't flash an empty screen.
  return (
    <div className="content" style={{ paddingTop: 60 }}>
      <div className="skeleton" style={{ height: 96, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 170, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 230 }} />
    </div>
  );
}

function AnimatedRoutes({
  settings,
  onSettingsChange,
}: {
  settings: SettingsType;
  onSettingsChange: (s: SettingsType) => void;
}) {
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
        {/* Keyed by path so a crash on one screen resets automatically when you
            navigate away, instead of needing a full app reload to recover. */}
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<RouteFallback />}>
            <Routes location={location}>
              <Route
                path="/"
                element={
                  <Dashboard
                    currency={settings.currency}
                    monthlyIncome={settings.monthlyIncome}
                  />
                }
              />
              <Route path="/add" element={<AddTransaction />} />
              <Route
                path="/history"
                element={<History currency={settings.currency} />}
              />
              <Route
                path="/transaction/:id"
                element={<TransactionDetail currency={settings.currency} />}
              />
              <Route
                path="/analytics"
                element={<Analytics currency={settings.currency} />}
              />
              <Route
                path="/settings"
                element={
                  <SettingsPage
                    settings={settings}
                    onSettingsChange={onSettingsChange}
                  />
                }
              />
            </Routes>
          </Suspense>
        </ErrorBoundary>
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
    const applied =
      settings.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : settings.theme;
    root.setAttribute("data-theme", applied);
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
    return (
      <Suspense fallback={<RouteFallback />}>
        <Onboarding onDone={async () => setSettings(await getSettings())} />
      </Suspense>
    );
  }

  const quickMode =
    isQuickAddContext() || window.location.hash.includes("quick=1");
  return (
    <HashRouter>
      <div className={"app-shell" + (quickMode ? " compact" : "")}>
        <AnimatedRoutes settings={settings} onSettingsChange={setSettings} />
        {!quickMode && <BottomNav />}
        <Toast />
      </div>
    </HashRouter>
  );
}
