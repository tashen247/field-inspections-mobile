import { useColorScheme } from 'react-native';
import type { InspectionStatus, Priority, Severity } from '@fim/shared';

const palette = {
  teal700: '#0E5E66',
  teal600: '#0E7C86',
  teal500: '#14A3AE',
  teal100: '#D7F2F3',
  amber500: '#E8A317',
  red600: '#C8372D',
  red500: '#E5534B',
  green600: '#2E8540',
  slate900: '#0F1720',
  slate800: '#17212B',
  slate700: '#243241',
  slate500: '#5B6B7B',
  slate300: '#B8C3CE',
  slate100: '#EEF2F5',
  white: '#FFFFFF',
};

export interface Theme {
  dark: boolean;
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    border: string;
    text: string;
    textMuted: string;
    primary: string;
    primaryText: string;
    primarySoft: string;
    danger: string;
    warning: string;
    success: string;
  };
  spacing: (n: number) => number;
  radius: { sm: number; md: number; lg: number; pill: number };
  font: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
}

const base = {
  spacing: (n: number) => n * 4,
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
  font: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 },
};

export const lightTheme: Theme = {
  dark: false,
  ...base,
  colors: {
    background: palette.slate100,
    surface: palette.white,
    surfaceAlt: '#F6F8FA',
    border: '#DCE3E9',
    text: palette.slate900,
    textMuted: palette.slate500,
    primary: palette.teal600,
    primaryText: palette.white,
    primarySoft: palette.teal100,
    danger: palette.red600,
    warning: palette.amber500,
    success: palette.green600,
  },
};

export const darkTheme: Theme = {
  dark: true,
  ...base,
  colors: {
    background: palette.slate900,
    surface: palette.slate800,
    surfaceAlt: palette.slate700,
    border: '#2E3E4E',
    text: '#E8EEF3',
    textMuted: palette.slate300,
    primary: palette.teal500,
    primaryText: palette.slate900,
    primarySoft: '#123B40',
    danger: palette.red500,
    warning: palette.amber500,
    success: '#4CAF63',
  },
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme;
}

export const statusColor: Record<InspectionStatus, string> = {
  assigned: '#4C7BD9',
  in_progress: palette.amber500,
  submitted: palette.teal500,
  approved: palette.green600,
  sent_back: palette.red500,
};

export const priorityColor: Record<Priority, string> = {
  urgent: palette.red500,
  high: palette.amber500,
  normal: '#4C7BD9',
  low: palette.slate500,
};

export const severityColor: Record<Severity, string> = {
  minor: '#E8C547',
  moderate: palette.amber500,
  severe: palette.red500,
};
