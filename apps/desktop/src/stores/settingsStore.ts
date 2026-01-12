import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SettingsState {
  // Auto-signout settings
  autoSignoutEnabled: boolean;
  autoSignoutMinutes: number;
  
  // Node Mode settings
  nodeModeEnabled: boolean;
  nodeModeAutoConnect: boolean;
  nodeModeBluetooth: boolean;
  nodeModeWiFiDirect: boolean;
  nodeModeLAN: boolean;
  
  // Actions
  setAutoSignout: (enabled: boolean, minutes: number) => void;
  setNodeMode: (enabled: boolean) => void;
  setNodeModeSettings: (settings: Partial<Pick<SettingsState, 'nodeModeAutoConnect' | 'nodeModeBluetooth' | 'nodeModeWiFiDirect' | 'nodeModeLAN'>>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoSignoutEnabled: false,
      autoSignoutMinutes: 15,
      
      // Node Mode defaults
      nodeModeEnabled: false,
      nodeModeAutoConnect: true,
      nodeModeBluetooth: true,
      nodeModeWiFiDirect: true,
      nodeModeLAN: true,
      
      setAutoSignout: (enabled, minutes) => set({ 
        autoSignoutEnabled: enabled, 
        autoSignoutMinutes: minutes 
      }),
      
      setNodeMode: (enabled) => set({ nodeModeEnabled: enabled }),
      
      setNodeModeSettings: (settings) => set(settings),
    }),
    {
      name: 'railgun-settings',
    }
  )
);
