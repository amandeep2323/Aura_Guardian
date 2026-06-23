/**
 * Aura Guardian - Theme Configuration
 * Defines dark and high-contrast themes for accessibility
 */

export type ThemeMode = 'dark' | 'light' | 'high-contrast';

export interface ThemeColors {
  // Base colors
  background: string;
  surface: string;
  surfaceVariant: string;
  
  // Text colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  
  // Status colors
  primary: string;
  primaryHover: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  
  // Device status
  connected: string;
  connecting: string;
  disconnected: string;
  
  // Distance zones
  distanceClear: string;
  distanceFar: string;
  distanceMedium: string;
  distanceClose: string;
  distanceDanger: string;
  
  // Borders
  border: string;
  borderHover: string;
}

export const THEMES: Record<ThemeMode, ThemeColors> = {
  dark: {
    background: '#0f0f0f',
    surface: '#1a1a1a',
    surfaceVariant: '#252525',
    
    textPrimary: '#ffffff',
    textSecondary: '#a0a0a0',
    textMuted: '#666666',
    
    primary: '#6366f1',
    primaryHover: '#4f46e5',
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#3b82f6',
    
    connected: '#22c55e',
    connecting: '#f59e0b',
    disconnected: '#ef4444',
    
    distanceClear: '#22c55e',
    distanceFar: '#84cc16',
    distanceMedium: '#f59e0b',
    distanceClose: '#f97316',
    distanceDanger: '#ef4444',
    
    border: '#333333',
    borderHover: '#444444',
  },
  light: {
    background: '#f5f5f5',
    surface: '#ffffff',
    surfaceVariant: '#e5e5e5',
    
    textPrimary: '#1a1a1a',
    textSecondary: '#666666',
    textMuted: '#999999',
    
    primary: '#4f46e5',
    primaryHover: '#4338ca',
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
    info: '#2563eb',
    
    connected: '#16a34a',
    connecting: '#d97706',
    disconnected: '#dc2626',
    
    distanceClear: '#16a34a',
    distanceFar: '#65a30d',
    distanceMedium: '#d97706',
    distanceClose: '#ea580c',
    distanceDanger: '#dc2626',
    
    border: '#e0e0e0',
    borderHover: '#d0d0d0',
  },
  'high-contrast': {
    background: '#000000',
    surface: '#0a0a0a',
    surfaceVariant: '#1a1a1a',
    
    textPrimary: '#ffffff',
    textSecondary: '#ffffff',
    textMuted: '#cccccc',
    
    primary: '#00ff00',
    primaryHover: '#00cc00',
    success: '#00ff00',
    warning: '#ffff00',
    danger: '#ff0000',
    info: '#00ffff',
    
    connected: '#00ff00',
    connecting: '#ffff00',
    disconnected: '#ff0000',
    
    distanceClear: '#00ff00',
    distanceFar: '#00ff00',
    distanceMedium: '#ffff00',
    distanceClose: '#ff8800',
    distanceDanger: '#ff0000',
    
    border: '#ffffff',
    borderHover: '#ffffff',
  },
};

/**
 * Get color for distance value
 */
export function getDistanceColor(distanceCm: number, theme: ThemeColors): string {
  if (distanceCm > 300) return theme.distanceClear;
  if (distanceCm > 200) return theme.distanceFar;
  if (distanceCm > 100) return theme.distanceMedium;
  if (distanceCm > 30) return theme.distanceClose;
  return theme.distanceDanger;
}

/**
 * Get battery color based on percentage
 */
export function getBatteryColor(percent: number, theme: ThemeColors): string {
  if (percent > 50) return theme.success;
  if (percent > 20) return theme.warning;
  return theme.danger;
}
