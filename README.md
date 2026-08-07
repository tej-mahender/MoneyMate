# Money Mate — v2

A private, offline-first personal finance tracker. No login, no cloud, no ads, no
analytics, no subscriptions. Every byte of data stays in this browser's IndexedDB,
on your device.

**New in v2:**
- **Calendar heatmap** — History tab → "Calendar" toggle. Color intensity per day
  shows how much you spent; tap a day to filter the transaction list to it.
- **Native Android home-screen widget** — a glanceable "X left this month" card on
  your home screen, no need to open the app. See `WIDGET.md` for the full
  architecture and build steps (needs Android Studio to compile — details inside).

## Run it locally (development)
```
npm install
npm run dev
```
Open the printed localhost URL.

## Build for hosting / installing to your phone as a PWA
```
npm install
npm run build
```
This produces a `dist/` folder — a fully static site. Deploy it anywhere free:

- **Netlify Drop** — go to https://app.netlify.com/drop and drag the `dist` folder in.
- **GitHub Pages** — push this repo, enable Pages, point it at `dist`.
- **Vercel** — `vercel deploy` from this folder.

Then on your phone: Share → "Add to Home Screen" (iOS Safari) or ⋮ menu →
"Install app" (Android Chrome). Full-screen, own icon, works offline.

## Building the native Android app (for the home-screen widget)
See `WIDGET.md`. Short version: `npx cap sync android`, then open `android/` in
Android Studio and hit Run. The PWA install above does **not** get you the widget —
a true OS widget needs the native wrapper.

## Data & backups
All data lives in IndexedDB in your browser (or, in the native app, the same
WebView storage). It does NOT sync between devices or browsers on its own — that's
the privacy tradeoff. Use Settings → Export backup regularly, especially before
clearing browser data or switching phones. Restore any backup from the same screen.

## Tech stack
React + TypeScript + Vite, Dexie (IndexedDB), Zustand, Recharts, React Router,
Framer Motion, vite-plugin-pwa, Capacitor (Android wrapper + custom native plugin
for the widget). No backend, no external API calls of any kind.

