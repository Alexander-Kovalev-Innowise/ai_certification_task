import { create } from 'zustand';

export const DEFAULT_ACCENT_HEX = '#00B300';

interface BrandAccentState {
  accentHex: string;
  setAccentHex: (hex: string) => void;
}

// The shader background lives at the app root, outside any tenant's
// BrandingProvider wrapper (which scopes --brand-primary to its own subtree),
// so the provider publishes its accent here for the background to follow.
export const useBrandAccentStore = create<BrandAccentState>((set) => ({
  accentHex: DEFAULT_ACCENT_HEX,
  setAccentHex: (accentHex) => set({ accentHex }),
}));
