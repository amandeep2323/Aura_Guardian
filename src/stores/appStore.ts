import { create } from 'zustand';

// Screen names for navigation
export type ScreenName =
  | 'splash'
  | 'login'
  | 'register'
  | 'profileSetup'
  | 'userHome'
  | 'deviceManager'
  | 'deviceDashboard'
  | 'sensorLiveView'
  | 'settings'
  | 'quickStatus';

interface AppState {
  // Navigation
  currentScreen: ScreenName;
  previousScreen: ScreenName | null;
  
  // App state
  isInitialized: boolean;
  isOnboarded: boolean;
  
  // User info
  userId: string | null;
  userRole: 'user' | 'guardian' | null;
  userName: string | null;
  
  // Actions
  navigateTo: (screen: ScreenName) => void;
  goBack: () => void;
  setInitialized: (value: boolean) => void;
  setOnboarded: (value: boolean) => void;
  setUser: (id: string, role: 'user' | 'guardian', name: string) => void;
  clearUser: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  currentScreen: 'splash',
  previousScreen: null,
  isInitialized: false,
  isOnboarded: false,
  userId: null,
  userRole: null,
  userName: null,

  // Navigation actions
  navigateTo: (screen) => {
    const current = get().currentScreen;
    set({ 
      currentScreen: screen,
      previousScreen: current 
    });
  },

  goBack: () => {
    const previous = get().previousScreen;
    if (previous) {
      set({ 
        currentScreen: previous,
        previousScreen: null 
      });
    }
  },

  // App state actions
  setInitialized: (value) => set({ isInitialized: value }),
  setOnboarded: (value) => set({ isOnboarded: value }),

  // User actions
  setUser: (id, role, name) => set({ 
    userId: id, 
    userRole: role,
    userName: name 
  }),

  clearUser: () => set({ 
    userId: null, 
    userRole: null,
    userName: null 
  }),
}));
