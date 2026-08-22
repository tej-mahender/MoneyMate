// jsdom has no real IndexedDB implementation — this in-memory polyfill lets
// Dexie (and therefore db.ts) run exactly as it does in a real browser,
// without needing a browser at all.
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
