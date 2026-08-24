# Home-screen Widget — how it works and how to build it

## Why this needs Android Studio, not just this chat

A true OS-level home-screen widget is native Android UI (`RemoteViews`, drawn by the
system launcher, not by a webpage). It's compiled as part of the Android app via
Gradle. I've written and wired up all the native code below, but compiling it into
an installable `.apk` requires the Android SDK + Gradle, which this sandbox doesn't
have. You'll need **Android Studio** (free, https://developer.android.com/studio) —
open the `android/` folder in it, let it sync, hit Run. That's genuinely the whole
remaining step; no further coding needed.

## Architecture

The web app (React) never talks to the widget directly — a widget can't run
JavaScript or read IndexedDB. Instead:

1. **`src/lib/widgetBridge.ts`** — on every Budget-screen render (`src/pages/Dashboard.tsx`, the category-level detail screen — not the app's Home landing screen), calls a custom native
   plugin (`WidgetBridge.updateWidget(...)`) with the current month's spent/budget/
   remaining totals. No-ops harmlessly when running as a plain website/PWA.
2. **`WidgetBridgePlugin.java`** (`android/app/src/main/java/com/pfos/app/`) — the
   native side of that plugin. Writes the snapshot into a small native
   `SharedPreferences` file (`pfos_widget`) — a different, OS-level storage
   mechanism from the WebView's IndexedDB — and immediately asks Android to redraw
   the widget.
3. **`BalanceWidgetProvider.java`** — the actual `AppWidgetProvider`. Reads that
   `SharedPreferences` file and renders `res/layout/balance_widget.xml` (spent /
   budget / remaining, a progress bar, the month label). This runs even if the app
   isn't open — that's what makes it "glanceable."
4. **`res/xml/balance_widget_info.xml`** — widget metadata: minimum size, that it's
   resizable, and a 30-minute periodic refresh as a fallback (Android's OS minimum;
   the instant push from step 2 covers the common case of "I just added a
   transaction").
5. Tapping the widget opens the app — the one deliberate exception to "without
   opening it," since a tap is an explicit request to go deeper.

All of this stays on-device. The widget reads a local SharedPreferences file the
app itself wrote moments earlier — nothing is fetched from a server.

## Build & install steps

```
npm install
npm run build
npx cap sync android
```

Then either:

- **Android Studio (recommended):** File → Open → select the `android/` folder →
  wait for Gradle sync → click Run (▶) with a device/emulator connected. This
  installs a debug build directly.
- **Command line (needs Android SDK + `ANDROID_HOME` set locally):**
  ```
  cd android
  ./gradlew assembleDebug
  ```
  The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk` — install it
  with `adb install app-debug.apk` or copy it to the phone and tap to install
  (enable "install from unknown sources" if it's not from the Play Store).

### "I cleaned/rebuilt in Android Studio and I'm still seeing the old version"

Android Studio's **Clean Project** / **Rebuild Project** only clears _native_
build caches (compiled Java/Kotlin, dex files). It has nothing to do with the
web app's content, which lives as a plain copy of `dist/` sitting inside
`android/app/src/main/assets/public/`. If that folder still holds an old
build, a native clean+rebuild will happily package it — right up to date on
everything except the one thing you actually changed. The fix is always the
same three commands, in this exact order, **every time you change any code
under `src/`:**

```
npm run build
npx cap sync android
```

Only _then_ clean/rebuild in Android Studio. If it's still stale after that:

1. Fully **uninstall** the old app from the device/emulator first, then
   install the new APK fresh — reinstalling over an existing install can
   leave old WebView storage (including the service worker's own asset
   cache) in place.
2. Check `android/app/src/main/assets/public/index.html`'s file modified
   timestamp — if it's older than your last `npm run build`, the sync step
   didn't run (or failed silently; check its terminal output for errors).
3. Bump `versionCode`/`versionName` in `android/app/build.gradle` for real
   releases — not required for this specific issue, but some install/update
   flows key off it, and it's good practice to bump per release regardless.

## Adding the widget to your home screen

Once the app is installed once (so it can write its first snapshot):

1. Long-press an empty area of your Android home screen.
2. Tap **Widgets**.
3. Find **Money Mate** → **Glanceable monthly balance**.
4. Drag it onto your home screen, resize if you like.
5. Open the app once and add/view a transaction — the widget updates within a
   second via the instant-push path; after that it also self-refreshes every 30
   minutes as a safety net.

## Known limitations / next steps

- **iOS widgets are not included.** iOS home-screen widgets require WidgetKit
  (Swift/SwiftUI, a separate Xcode "widget extension" target) and can only be
  built on macOS with Xcode — genuinely not possible from this environment at all,
  sandboxed or not. If you want an iOS widget later, the architecture above
  transfers conceptually (native code reads a small local snapshot, no server), it
  would just need a Mac to build.
- The widget's progress bar uses the system default styling rather than the app's
  brass/green/amber/red palette — `RemoteViews` restricts custom drawable tinting
  before Android 12. Easy incremental polish, not a blocker.
- Only shows the current month's snapshot. Multiple sizes (e.g. a larger 4x2
  variant with a mini category breakdown) would be a natural v3 addition using
  Android 12's widget size responsiveness.
