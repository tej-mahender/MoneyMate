import { describe, it, expect, beforeEach, vi } from "vitest";
import { installGlobalErrorHandlers } from "./globalErrors";
import { useUIStore } from "../store/useUIStore";

function rejection(reason: unknown) {
  return Object.assign(new Event("unhandledrejection"), { reason });
}

beforeEach(() => {
  useUIStore.setState({ toastMsg: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("installGlobalErrorHandlers", () => {
  it("shows a toast when a promise rejection goes unhandled", () => {
    const remove = installGlobalErrorHandlers();
    window.dispatchEvent(rejection(new Error("boom")));
    expect(useUIStore.getState().toastMsg).toMatch(/something went wrong/i);
    remove();
  });

  it("stops listening once removed", () => {
    const remove = installGlobalErrorHandlers();
    remove();
    window.dispatchEvent(rejection(new Error("boom")));
    expect(useUIStore.getState().toastMsg).toBeNull();
  });
});
