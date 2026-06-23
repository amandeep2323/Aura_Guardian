// Device types for Aura Guardian system
export type DeviceType = 'chest' | 'left_band' | 'right_band' | 'headphones';

// Connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Device model representing a connected Wi-Fi device
export interface Device {
  id: string;              // Device ID (hostname/MAC alias)
  name: string;            // Device name (e.g., "AuraGuard-Chest")
  type: DeviceType;        // Type of device
  status: ConnectionStatus; // Current connection status
  battery: number;         // Battery percentage (0-100)
  rssi: number;            // Signal strength in dBm
  lastSeen: Date;          // Last time we received data
  firmwareVersion?: string; // Firmware version if available
  isConnected: boolean;    // Quick check if connected
}

// Wi-Fi discovery result before connection
export interface ScanResult {
  id: string;
  name: string;
  rssi: number;
  serviceEndpoints?: string[];
}

// Create a new device from scan result
export function createDevice(scanResult: ScanResult, type: DeviceType): Device {
  return {
    id: scanResult.id,
    name: scanResult.name,
    type,
    status: 'disconnected',
    battery: 100,
    rssi: scanResult.rssi,
    lastSeen: new Date(),
    isConnected: false,
  };
}

// Get device type from device name
export function getDeviceTypeFromName(name: string): DeviceType {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('chest') || lowerName.includes('main')) return 'chest';
  if (lowerName.includes('left')) return 'left_band';
  if (lowerName.includes('right')) return 'right_band';
  if (lowerName.includes('headphone') || lowerName.includes('audio')) return 'headphones';
  return 'chest'; // Default
}
