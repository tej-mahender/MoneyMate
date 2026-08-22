# Money Mate

A private, offline-first personal finance tracker for Android. No login, no
cloud sync, no ads, no analytics, no subscriptions. Every byte of your
financial data stays on your device, in your device's own local storage —
this app has no backend and makes no network calls of any kind.

Built as a personal tool for one thing budgeting apps rarely get right: the
difference between money you're **spending** (Rent, Food — capped by a
budget) and money you're **allocating** (Savings, Investments, EMI — a
transfer with a target, not a spend). See [Architecture](#architecture)
below for why that distinction drives the whole data model.

## Screens, at a glance

| Screen              | Purpose                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**            | Landing screen. Income, and one card per bracket (Expenditure, Savings, Investments, Income, or any custom one) with this month's progress. "Unallocated" — money you haven't given a job to yet — is front and center.            |
| **Budget**          | Daily-use shortcut: capped spending only, aggregated across every spend-kind bracket. Ring, by-category breakdown, today/daily-average/days-left, recent transactions.                                                             |
| **Bracket detail**  | One reusable page for any bracket's own categories — Rent/Food under Expenditure, Portfolio/Gold under Investments, Salary/Freelance under Income. Add, edit, archive, or delete categories; rename or archive the bracket itself. |
| **Add transaction** | Log an expense or income entry: amount, category, date, and optional merchant/note.                                                                                                                                                |
| **History**         | Full transaction list with search, month filter, category filter, and a calendar-heatmap view.                                                                                                                                     |
| **Insights**        | Charts: spend trends, category breakdown, income vs. spend, day-of-week patterns, top merchants, budget vs. actual.                                                                                                                |
| **Settings**        | Manage brackets, recurring transactions, currency/theme/income preferences, backup & restore, and data exports.                                                                                                                    |

## Architecture

Two levels, not one flat list of categories:

- **Bracket** — the top-level classification: `Expenditure`, `Savings`,
  `Investments`, `Income` by default, plus any custom bracket you add (EMI,
  Work Expenses, etc.). Each bracket has a `kind`:
  - `spend` — a capped budget. Only `spend`-kind brackets drive the Budget
    screen's ring, "Spent," and "Remaining" figures.
  - `allocation` — a transfer out of income toward a goal (Savings,
    Investments, EMI…). Has a soft _target_, not a hard cap, and never
    counts against the spending cap.
  - `income` — a source of money in. Budget/target is meaningless here.
- **Category** — belongs to exactly one bracket and inherits its `kind`.
  Rent and Food live under Expenditure; Portfolio and Gold could live under
  Investments. A bracket with a single category and a bracket with ten
  behave identically everywhere — sub-dividing is entirely optional per
  bracket, never a special case in the code.

A bracket's own total is always the sum of its categories' budgets — a
bracket never carries a budget field of its own. This is what lets any
bracket be tapped into its own detail page for further breakdown, with no
distinction between "the app's built-in categories" and "brackets you
added yourself."

## Tech stack

- **App**: React 19, TypeScript, Vite, React Router
- **Storage**: Dexie.js (IndexedDB) — versioned schema with migrations, no server
- **State**: Zustand (UI state), `dexie-react-hooks` (live-query reactive data)
- **UI**: Framer Motion, Recharts, Lucide icons, self-hosted Fontsource fonts
  (Fraunces, Plus Jakarta Sans, JetBrains Mono)
- **PWA**: `vite-plugin-pwa` — installable, works offline
- **Native Android**: Capacitor, with a custom native plugin
  (`WidgetBridgePlugin.java`) powering small and large home-screen widgets
- **Testing**: Vitest, React Testing Library, `jest-axe` (automated
  accessibility audits) — 170 tests across 13 files, covering unit,
  integration, performance, capability, and accessibility concerns
- **Linting**: oxlint

No backend, no third-party SDKs, no analytics libraries.

## Data & backups

All data lives in IndexedDB — in the browser if you're running the PWA, or
the same WebView storage if you're running the native Android app. It does
**not** sync between devices or browsers; that's the deliberate privacy
tradeoff of an app with no server. Use **Settings → Your data → Export
backup** regularly, especially before clearing browser data, uninstalling,
or switching phones. Restore any backup from the same screen — including
one from an older schema version; imports are backward-compatible all the
way back.

### Exporting for analysis

Settings → Analysis exports gives you:

| File                         | Grain                                 | Use                                           |
| ---------------------------- | ------------------------------------- | --------------------------------------------- |
| `pfos-transactions-*.csv`    | One row per transaction               | Fact table                                    |
| `pfos-categories-*.csv`      | One row per category                  | Dimension table                               |
| `pfos-brackets-*.csv`        | One row per bracket                   | Dimension table                               |
| `pfos-monthly-summary-*.csv` | One row per (month, category)         | Pre-aggregated budget vs. actual              |
| `pfos-ml-dataset-*.json`     | All tables + recurring rules, bundled | Single-file load for a Python/pandas notebook |
| `pfos-backup-*.json`         | Full raw state                        | Restore/backup — not intended for analysis    |

Full column-level documentation and a Power BI setup guide are in
[`DATA_SCHEMA.md`](./DATA_SCHEMA.md).

## Running it locally (development)

```bash
npm install
npm run dev
```

Open the printed localhost URL.

## Testing

```bash
npm test          # run the full suite once
npm run test:watch  # watch mode
```

Every change is expected to pass `tsc -b`, `vite build`, `oxlint`, and the
full test suite before shipping — see `npm run build` and `npm run lint`.

## Building for the web (PWA)

```bash
npm install
npm run build
```

This produces a `dist/` folder — a fully static site. Deploy it anywhere
free:

- **Netlify Drop** — go to https://app.netlify.com/drop and drag the `dist` folder in.
- **GitHub Pages** — push this repo, enable Pages, point it at `dist`.
- **Vercel** — `vercel deploy` from this folder.

Then on your phone: Share → "Add to Home Screen" (iOS Safari) or ⋮ menu →
"Install app" (Android Chrome). Full-screen, own icon, works offline.

## Building the native Android app (for the home-screen widget)

The PWA install above does **not** get you the home-screen widget — a true
OS widget needs the native wrapper.

```bash
npx cap sync android
```

Then open `android/` in Android Studio and hit Run. See
[`WIDGET.md`](./WIDGET.md) for the full native architecture — the
`WidgetBridge` plugin, both widget providers, and how the "+" quick-add
button deep-links back into the app.

**Before building a release APK**, bump `versionCode` in
`android/app/build.gradle` — Android requires it to increase for the app to
install as an update over an existing install on your device.

## Project structure

```
src/
  db/           Dexie schema, migrations, core queries (db.ts)
  lib/          CSV/backup import-export, formatting, widget bridge
  pages/        One file per screen — colocated *.test.tsx alongside each
  components/   Shared UI (CategoryRow, IconPicker, Dropdown, BottomNav…)
  store/        Zustand UI store (toasts, etc.)
  test/         Cross-cutting tests that don't belong to a single file
                (performance, end-to-end capability flows)
android/        Capacitor native wrapper + custom widget plugin (Java)
DATA_SCHEMA.md  Export column reference + Power BI setup
WIDGET.md       Native widget architecture
```

Tests are colocated with the file they test (`Dashboard.tsx` +
`Dashboard.test.tsx`) so a rename or delete naturally takes its test with
it; anything that spans multiple files instead lives in `src/test/`.
