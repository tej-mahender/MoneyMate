import { lazy, Suspense, useEffect, useState } from "react";
import {
  HashRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  getSettings,
  processRecurring,
  type Settings as SettingsType,
} from "./db/db";
import { todayISO } from "./lib/format";
import { consumePendingWidgetRoute } from "./lib/widgetBridge";
import { startWidgetSync } from "./lib/widgetSync";
import BootError from "./components/BootError";
import Overview from "./pages/Overview";
import BottomNav from "./components/BottomNav";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import ErrorBoundary from "./components/ErrorBoundary";
import BudgetHistoryKeeper from "./components/BudgetHistoryKeeper";

// Code-split everything except Overview (Home), which is the landing screen
// on every normal launch and should paint immediately with no extra network
// round-trip. The rest — including Dashboard/Budget, now a drill-down one
// tap away rather than the landing screen, and especially Analytics, which
// alone pulls in the recharts dependency — only need to load once the
// person actually navigates there, so they shouldn't cost anything on first
// paint.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const BracketDetail = lazy(() => import("./pages/BracketDetail"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const AddTransaction = lazy(() => import("./pages/AddTransaction"));
const History = lazy(() => import("./pages/History"));
const TransactionDetail = lazy(() => import("./pages/TransactionDetail"));
const Analytics = lazy(() => import("./pages/Analytics"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const SplitTracker = lazy(() => import("./pages/SplitTracker"));

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
  const navigate = useNavigate();

  // If the app was just launched from the widget's "+" button, jump
  // straight to the add-transaction screen instead of the dashboard. Runs
  // once on mount — consumePendingWidgetRoute() clears the native-side
  // value as it reads it, so this can't re-fire on a later remount.
  useEffect(() => {
    (async () => {
      const route = await consumePendingWidgetRoute();
      if (route) navigate(route, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                  <Overview
                    currency={settings.currency}
                    monthlyIncome={settings.monthlyIncome}
                  />
                }
              />
              <Route path="/add" element={<AddTransaction />} />
              <Route
                path="/budget"
                element={
                  <Dashboard currency={settings.currency} />
                }
              />
              <Route
                path="/bracket/:id"
                element={
                  <BracketDetail
                    currency={settings.currency}
                    monthlyIncome={settings.monthlyIncome}
                  />
                }
              />
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
                path="/owed"
                element={<SplitTracker currency={settings.currency} />}
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

// If opening the database hasn't finished by then, treat it as failed so the
// person gets a way out instead of a skeleton that never goes away.
const BOOT_TIMEOUT_MS = 15000;

export default function App() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBootError(null);
    const boot = (async () => {
      try {
        await processRecurring(todayISO());
      } catch (err) {
        // Due recurring items are nice-to-have at launch; a failure here
        // must not stop the app opening. getSettings() below is the real
        // "can we use the database at all" check.
        console.warn("Recurring processing failed at launch", err);
      }
      return getSettings();
    })();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Opening storage took too long.")),
        BOOT_TIMEOUT_MS,
      ),
    );
    Promise.race([boot, timeout]).then(
      (s) => {
        if (cancelled) return;
        setSettings(s);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        console.error("App failed to start:", err);
        setBootError(
          err instanceof Error && err.message ? err.message : "Unknown error.",
        );
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Keep the home-screen widget in step with the data from one place (no-op
  // outside the Android app). Starts once the database has opened.
  const dbReady = settings !== null;
  useEffect(() => {
    if (!dbReady) return;
    return startWidgetSync();
  }, [dbReady]);

  const theme = settings?.theme;
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    const applied =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : theme;
    root.setAttribute("data-theme", applied);
  }, [theme]);

  if (bootError) {
    return (
      <>
        <BootError message={bootError} onRetry={() => setAttempt((n) => n + 1)} />
        <Toast />
      </>
    );
  }

  if (loading || !settings) {
    return (
      <div className="app-shell">
        <div className="content" style={{ paddingTop: 60 }}>
          <div className="skeleton" style={{ height: 96, marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 170, marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 230 }} />
        </div>
        <Toast />
      </div>
    );
  }

  if (!settings.onboarded) {
    return (
      <>
        <Suspense fallback={<RouteFallback />}>
          <Onboarding onDone={async () => setSettings(await getSettings())} />
        </Suspense>
        <Toast />
      </>
    );
  }

  return (
    <HashRouter>
      <div className="app-shell">
        <AnimatedRoutes settings={settings} onSettingsChange={setSettings} />
        <BottomNav />
        <Toast />
        <BudgetHistoryKeeper />
        <ConfirmDialog />
      </div>
    </HashRouter>
  );
}
