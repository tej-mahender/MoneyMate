import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import Toast from "./Toast";
import { useUIStore } from "../store/useUIStore";

afterEach(() => {
  useUIStore.setState({ toastMsg: null });
});

describe("Toast", () => {
  it("renders nothing when there is no message", () => {
    render(<Toast />);
    expect(screen.queryByText(/./)).not.toBeInTheDocument();
  });

  it("renders the message once showToast is called", async () => {
    render(<Toast />);
    act(() => {
      useUIStore.getState().showToast("Transaction deleted.");
    });
    expect(await screen.findByText("Transaction deleted.")).toBeInTheDocument();
  });

  it("auto-dismisses after its timeout", async () => {
    render(<Toast />);
    act(() => {
      useUIStore.getState().showToast("Saved.");
    });
    expect(await screen.findByText("Saved.")).toBeInTheDocument();

    await waitFor(
      () => expect(screen.queryByText("Saved.")).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
  }, 6000);

  // Regression guard for the centering bug: the positioning wrapper
  // (.toast-wrap) must be a plain, non-animated element so Framer Motion's
  // own transform (driving the y-slide animation on the bubble inside)
  // never overwrites a CSS `transform: translateX(-50%)` that centering
  // depended on previously — that clobbering is what pushed the toast
  // visibly off to the right.
  it("keeps the centering wrapper separate from the animated bubble", async () => {
    render(<Toast />);
    act(() => {
      useUIStore.getState().showToast("Hello");
    });
    const bubble = await screen.findByText("Hello");
    const wrap = bubble.closest(".toast-wrap");
    expect(wrap).not.toBeNull();
    expect(bubble.className).toContain("toast");
    expect(wrap).not.toBe(bubble);
  });
});
