# Personal Finance OS (PFOS) — v1

A private, offline-first personal finance tracker. No login, no cloud, no ads, no
analytics, no subscriptions. Every byte of data stays in this browser's IndexedDB,
on your device.

This is the base version — dashboard, quick add, transaction history with search,
analytics (category pie / 6-month trend / budget vs actual), recurring
transactions, and full JSON/CSV backup & export. (Calendar heatmap and the native
Android home-screen widget were added in v2.)

## Run it locally (development)
```
npm install
npm run dev
```
Open the printed localhost URL.

## Build for hosting / installing to your phone
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

## Data & backups
All data lives in IndexedDB in your browser. It does NOT sync between devices or
browsers on its own — that's the privacy tradeoff. Use Settings → Export backup
regularly, especially before clearing browser data or switching phones. Restore
any backup from the same screen.

## Tech stack
React + TypeScript + Vite, Dexie (IndexedDB), Zustand, Recharts, React Router,
Framer Motion, vite-plugin-pwa. No backend, no external API calls of any kind.
