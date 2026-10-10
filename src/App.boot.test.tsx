import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./db/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db/db")>();
  return {
    ...actual,
    getSettings: vi.fn(),
    processRecurring: vi.fn(),
  };
});

import App from "./App";
import { getSettings, processRecurring } from "./db/db";
import { useUIStore } from "./store/useUIStore";

const settings = {
  id: 1,
  onboarded: false,
  currency: "₹",
  theme: "dark" as const,
  monthlyIncome: 0,
  carryForward: false,
  hideWidgetAmounts: false,
};

beforeEach(() => {
  vi.mocked(getSettings).mockReset();
  vi.mocked(processRecurring).mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("App startup failures", () => {
  it("shows a recovery screen instead of an endless skeleton when the database can't be opened", async () => {
    vi.mocked(getSettings).mockRejectedValue(new Error("IDB blocked"));
    render(<App />);

    expect(await screen.findByText("Couldn't open your data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save a backup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset app data" })).toBeInTheDocument();
  });

  it("Try again re-runs startup and leaves the error screen once it works", async () => {
    vi.mocked(getSettings)
      .mockRejectedValueOnce(new Error("IDB blocked"))
      .mockResolvedValue(settings);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(screen.queryByText("Couldn't open your data")).not.toBeInTheDocument(),
    );
    expect(getSettings).toHaveBeenCalledTimes(2);
  });

  it("a failure while processing recurring items does not stop the app opening", async () => {
    vi.mocked(processRecurring).mockRejectedValue(new Error("bad recurring row"));
    vi.mocked(getSettings).mockResolvedValue(settings);
    render(<App />);

    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Couldn't open your data")).not.toBeInTheDocument(),
    );
  });

  it("asks twice before resetting app data", async () => {
    vi.mocked(getSettings).mockRejectedValue(new Error("IDB blocked"));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Reset app data" }));
    expect(
      screen.getByRole("button", { name: "Tap again to erase everything" }),
    ).toBeInTheDocument();
  });
});

describe("App — toasts are visible before the main app shell exists", () => {
  it("on the startup-failure screen", async () => {
    vi.mocked(getSettings).mockRejectedValue(new Error("IDB blocked"));
    render(<App />);
    await screen.findByText("Couldn't open your data");

    act(() => useUIStore.getState().showToast("Something went wrong. Please try again."));

    expect(
      await screen.findByText("Something went wrong. Please try again."),
    ).toBeInTheDocument();
  });

  it("on the onboarding screen", async () => {
    vi.mocked(getSettings).mockResolvedValue(settings); // onboarded: false
    render(<App />);
    await screen.findByText("Get started");

    act(() => useUIStore.getState().showToast("Couldn't save that. Please try again."));

    expect(
      await screen.findByText("Couldn't save that. Please try again."),
    ).toBeInTheDocument();
  });
});
