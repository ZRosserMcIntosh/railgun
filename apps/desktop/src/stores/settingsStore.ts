import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SettingsState {
  // Auto-signout settings
  autoSignoutEnabled: boolean;
  autoSignoutMinutes: number;
  
  // Actions
  setAutoSignout: (enabled: boolean, minutes: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoSignoutEnabled: false,
      autoSignoutMinutes: 15,
      
      setAutoSignout: (enabled, minutes) => set({ 
        autoSignoutEnabled: enabled, 
        autoSignoutMinutes: minutes 
      }),
    }),
    {
      name: 'railgun-settings',
    }
  )
);
