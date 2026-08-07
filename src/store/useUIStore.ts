import { create } from "zustand";

interface UIState {
  toastMsg: string | null;
  showToast: (msg: string) => void;
  clearToast: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  toastMsg: null,
  showToast: (msg: string) => {
    set({ toastMsg: msg });
    setTimeout(() => set({ toastMsg: null }), 2400);
  },
  clearToast: () => set({ toastMsg: null }),
}));
