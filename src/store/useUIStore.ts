import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses danger styling (red). */
  danger?: boolean;
}

interface UIState {
  toastMsg: string | null;
  showToast: (msg: string) => void;
  clearToast: () => void;

  /** Currently-visible confirm dialog, or null when hidden. */
  confirmDialog: (ConfirmOptions & { resolve: (result: boolean) => void }) | null;
  /**
   * Promise-based replacement for `window.confirm()`. Renders a custom
   * in-app dialog and resolves `true` (confirm) or `false` (cancel).
   */
  showConfirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Called by the dialog component when the user picks a button. */
  resolveConfirm: (result: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  toastMsg: null,
  showToast: (msg: string) => {
    set({ toastMsg: msg });
    setTimeout(() => set({ toastMsg: null }), 2400);
  },
  clearToast: () => set({ toastMsg: null }),

  confirmDialog: null,
  showConfirm: (opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      set({ confirmDialog: { ...opts, resolve } });
    }),
  resolveConfirm: (result: boolean) => {
    const dialog = get().confirmDialog;
    if (dialog) {
      dialog.resolve(result);
      set({ confirmDialog: null });
    }
  },
}));
