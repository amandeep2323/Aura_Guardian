import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light' | 'high-contrast';

interface ThemeState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',

      setTheme: (theme) => set({ theme }),

      toggleTheme: () => {
        const current = get().theme;
        const themes: ThemeMode[] = ['dark', 'light', 'high-contrast'];
        const currentIndex = themes.indexOf(current);
        const nextIndex = (currentIndex + 1) % themes.length;
        set({ theme: themes[nextIndex] });
      },
    }),
    {
      name: 'aura-guardian-theme',
    }
  )
);
