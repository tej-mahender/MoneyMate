import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dropdown from "./Dropdown";

const OPTIONS = [
  { value: "rent", label: "Rent" },
  { value: "food", label: "Food" },
  { value: "transport", label: "Transport" },
];

function setup(props: Partial<React.ComponentProps<typeof Dropdown>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <Dropdown value="rent" options={OPTIONS} onChange={onChange} {...props} />,
  );
  return { onChange, ...utils };
}

describe("Dropdown — basic rendering", () => {
  it("shows the label of the currently selected option on the closed trigger", () => {
    setup({ value: "food" });
    expect(screen.getByRole("button", { name: /food/i })).toBeInTheDocument();
  });
  it("shows the placeholder when no option matches the current value", () => {
    setup({ value: "does-not-exist", placeholder: "Pick one…" });
    expect(
      screen.getByRole("button", { name: /pick one/i }),
    ).toBeInTheDocument();
  });
  it("does not show the options panel before it is opened", () => {
    setup();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("Dropdown — mouse interaction", () => {
  it("opens the panel and lists every option on trigger click", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /rent/i }));
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Rent")).toBeInTheDocument();
    expect(within(listbox).getByText("Food")).toBeInTheDocument();
    expect(within(listbox).getByText("Transport")).toBeInTheDocument();
  });

  it("calls onChange with the clicked option's value and closes the panel", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("button", { name: /rent/i }));
    const listbox = screen.getByRole("listbox");
    await user.click(screen.getByText("Food"));
    expect(onChange).toHaveBeenCalledWith("food");
    // AnimatePresence keeps the panel mounted through its exit transition.
    await waitFor(() => expect(listbox).not.toBeInTheDocument());
  });

  it("marks the currently selected option with aria-selected", async () => {
    const user = userEvent.setup();
    setup({ value: "food" });
    await user.click(screen.getByRole("button", { name: /food/i }));
    expect(screen.getByRole("option", { name: "Food" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Rent" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("clicking outside the trigger and panel closes it without selecting anything", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole("button", { name: /rent/i }));
    const listbox = screen.getByRole("listbox");
    await user.click(document.body);
    // AnimatePresence keeps the panel mounted through its exit transition,
    // so it disappears shortly after the click rather than synchronously.
    await waitFor(() => expect(listbox).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Dropdown — keyboard interaction", () => {
  it("ArrowDown on the closed trigger opens the panel", async () => {
    const user = userEvent.setup();
    setup();
    screen.getByRole("button", { name: /rent/i }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("Escape closes an open panel and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole("button", { name: /rent/i });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // AnimatePresence's exit transition means removal isn't necessarily
    // synchronous with the keypress, so poll rather than assert immediately.
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("Enter on a focused option selects it", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    screen.getByRole("button", { name: /rent/i }).focus();
    await user.keyboard("{ArrowDown}"); // open, focuses the selected ("Rent") option
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Rent" })).toHaveFocus(),
    );
    await user.keyboard("{ArrowDown}"); // move to "Food"
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("food");
  });

  it("ArrowDown/ArrowUp move focus between options without wrapping past the ends", async () => {
    const user = userEvent.setup();
    setup();
    screen.getByRole("button", { name: /rent/i }).focus();
    await user.keyboard("{ArrowDown}"); // opens, focuses "Rent" (index 0, the selected one)
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Rent" })).toHaveFocus(),
    );
    await user.keyboard("{ArrowUp}"); // already at top — should stay clamped at index 0
    expect(screen.getByRole("option", { name: "Rent" })).toHaveFocus();
  });

  it("Home and End jump to the first and last option", async () => {
    const user = userEvent.setup();
    setup();
    screen.getByRole("button", { name: /rent/i }).focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Rent" })).toHaveFocus(),
    );
    await user.keyboard("{End}");
    expect(screen.getByRole("option", { name: "Transport" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("option", { name: "Rent" })).toHaveFocus();
  });

  it("typing a letter jumps focus to the next option starting with it (type-ahead)", async () => {
    const user = userEvent.setup();
    setup();
    screen.getByRole("button", { name: /rent/i }).focus();
    await user.keyboard("{ArrowDown}"); // opens, focus on "Rent"
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Rent" })).toHaveFocus(),
    );
    await user.keyboard("t"); // should jump to "Transport" (the only other option starting with T)
    expect(screen.getByRole("option", { name: "Transport" })).toHaveFocus();
  });
});
