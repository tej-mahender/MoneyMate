import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: false,
    restoreMocks: true,
    // Pinned so date-formatting tests (format.test.ts) are deterministic
    // regardless of the host/CI machine's default timezone. IST (UTC+5:30)
    // is deliberately chosen because it's a positive offset — that's the
    // exact condition that caused the original production bug (an earlier
    // `.toISOString()`-based implementation rolled dates back by one near
    // local midnight in any timezone ahead of UTC). Running tests in a
    // positive-offset zone means that regression class can't silently creep
    // back in and slip past a suite that only ever ran in UTC.
    env: { TZ: 'Asia/Kolkata' },
  },
});
