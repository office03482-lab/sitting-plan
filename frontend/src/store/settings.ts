import { create } from 'zustand';

export interface SchoolSettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  principal_name: string;
  established_year: number;
  timezone: string;
  date_format: string;
  default_batch_colors: Record<string, string>;
  export_format: 'pdf' | 'excel' | 'both';
  auto_save: boolean;
  conflict_detection: boolean;
  email_notifications: boolean;
}

interface SettingsState {
  settings: SchoolSettings;
  isLoading: boolean;
  error: string | null;
  updateSettings: (settings: Partial<SchoolSettings>) => void;
  updateBatchColor: (batch: string, color: string) => void;
  resetSettings: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const defaultSettings: SchoolSettings = {
  name: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  principal_name: '',
  established_year: new Date().getFullYear(),
  timezone: 'Asia/Kolkata',
  date_format: 'DD/MM/YYYY',
  default_batch_colors: {
    '11th': '#3B82F6',
    '12th': '#10B981',
    'Dropper 1': '#F59E0B',
    'Dropper 2': '#EF4444',
    'Dropper 3': '#8B5CF6',
    'Dropper 4': '#06B6D4',
    'Dropper 5': '#84CC16',
    'Dropper 6': '#F97316',
    'Dropper 7': '#EC4899',
    'Dropper 8': '#6B7280',
    'Dropper 9': '#374151',
    'Dropper 10': '#1F2937'
  },
  export_format: 'both',
  auto_save: true,
  conflict_detection: true,
  email_notifications: false
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  isLoading: false,
  error: null,

  updateSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings }
    })),

  updateBatchColor: (batch, color) =>
    set((state) => ({
      settings: {
        ...state.settings,
        default_batch_colors: {
          ...state.settings.default_batch_colors,
          [batch]: color
        }
      }
    })),

  resetSettings: () =>
    set({ settings: defaultSettings }),

  setLoading: (loading) =>
    set({ isLoading: loading }),

  setError: (error) =>
    set({ error })
}));