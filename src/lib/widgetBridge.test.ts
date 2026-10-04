import { describe, it, expect, beforeEach, vi } from "vitest";

const getPendingRoute = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ getPendingRoute, updateWidget: vi.fn() }),
}));

import { consumePendingWidgetRoute } from "./widgetBridge";

beforeEach(() => {
  getPendingRoute.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("consumePendingWidgetRoute", () => {
  it("returns /add, the one route the widget's + button can ask for", async () => {
    getPendingRoute.mockResolvedValue({ route: "/add" });
    expect(await consumePendingWidgetRoute()).toBe("/add");
  });

  it.each(["/settings", "/history", "/owed", "/transaction/1", "//evil", "add", ""])(
    "ignores any other route an intent might have carried (%j)",
    async (route) => {
      getPendingRoute.mockResolvedValue({ route });
      expect(await consumePendingWidgetRoute()).toBeNull();
    },
  );

  it("returns null when nothing is pending", async () => {
    getPendingRoute.mockResolvedValue({ route: null });
    expect(await consumePendingWidgetRoute()).toBeNull();
  });

  it("returns null instead of throwing when the native call fails", async () => {
    getPendingRoute.mockRejectedValue(new Error("plugin missing"));
    expect(await consumePendingWidgetRoute()).toBeNull();
  });
});
