/**
 * Aura Guardian - Device Log Model
 * Connection and error log entries for devices
 */

import { type DeviceType } from '../config/constants';

export type DeviceLogEventType = 
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'low_battery'
  | 'firmware'
  | 'scan_started'
  | 'scan_stopped'
  | 'reconnecting'
  | 'data_received';

export interface DeviceLog {
  id: string;
  deviceType: DeviceType;
  eventType: DeviceLogEventType;
  deviceName: string;
  message: string;
  batteryAtEvent: number | null;
  rssiAtEvent: number | null;
  timestamp: number;
}

/**
 * Create a new device log entry
 */
export function createDeviceLog(
  deviceType: DeviceType,
  eventType: DeviceLogEventType,
  deviceName: string,
  message: string,
  batteryAtEvent?: number,
  rssiAtEvent?: number
): DeviceLog {
  return {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    deviceType,
    eventType,
    deviceName,
    message,
    batteryAtEvent: batteryAtEvent ?? null,
    rssiAtEvent: rssiAtEvent ?? null,
    timestamp: Date.now(),
  };
}

/**
 * Get icon name for event type
 */
export function getEventTypeIcon(eventType: DeviceLogEventType): string {
  switch (eventType) {
    case 'connected':
      return 'check-circle';
    case 'disconnected':
      return 'x-circle';
    case 'error':
      return 'alert-triangle';
    case 'low_battery':
      return 'battery-low';
    case 'firmware':
      return 'cpu';
    case 'scan_started':
      return 'search';
    case 'scan_stopped':
      return 'search-x';
    case 'reconnecting':
      return 'refresh-cw';
    case 'data_received':
      return 'activity';
    default:
      return 'info';
  }
}

/**
 * Get color for event type
 */
export function getEventTypeColor(eventType: DeviceLogEventType): string {
  switch (eventType) {
    case 'connected':
      return 'text-green-500';
    case 'disconnected':
      return 'text-red-500';
    case 'error':
      return 'text-red-500';
    case 'low_battery':
      return 'text-yellow-500';
    case 'firmware':
      return 'text-blue-500';
    case 'scan_started':
    case 'scan_stopped':
      return 'text-purple-500';
    case 'reconnecting':
      return 'text-orange-500';
    case 'data_received':
      return 'text-cyan-500';
    default:
      return 'text-gray-500';
  }
}

/**
 * Format timestamp for display
 */
export function formatLogTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
