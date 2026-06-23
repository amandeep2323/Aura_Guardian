/**
 * Aura Guardian - Wi-Fi ESP32 Config
 * Contains device host and endpoint paths for ESP32 DevKit v1 communication.
 */

export const WIFI_CONFIG = {
  // Primary ESP32 host (mDNS on LAN) and fallback AP IP
  host: 'esp32.local',
  fallbackHost: '192.168.4.1',

  // REST/WS endpoints served by ESP32 firmware
  endpoints: {
    sensorStream: '/ws/sensor',
    leftHaptic: '/api/haptic/left',
    rightHaptic: '/api/haptic/right',
    systemStatus: '/api/system/status',
  },

  // Discovery filter metadata
  discovery: {
    ssidPrefix: 'AuraGuardian',
    mdnsService: '_auraguard._tcp.local',
  },

  // Packet structure info
  packetInfo: {
    v1: {
      length: 10,
      header: 0xAA,
      fields: [
        { name: 'header', offset: 0, size: 1 },
        { name: 'left_cm', offset: 1, size: 1 },
        { name: 'center_cm', offset: 2, size: 1 },
        { name: 'right_cm', offset: 3, size: 1 },
        { name: 'ground_cm', offset: 4, size: 1 },
        { name: 'far_cm', offset: 5, size: 1 },
        { name: 'battery_percent', offset: 6, size: 1 },
        { name: 'imu_flags', offset: 7, size: 1 },
        { name: 'reserved', offset: 8, size: 1 },
        { name: 'checksum', offset: 9, size: 1 },
      ],
    },
    v2: {
      length: 14,
      header: 0xAA,
      // Future: 2 bytes per distance for full 4m range
    },
  },

  // IMU flags bit positions
  imuFlags: {
    fallDetected: 0,      // bit 0
    stairsDetected: 1,    // bit 1
    roughSurface: 2,      // bit 2
    stepCountMask: 0xF8,  // bits 3-7 (0-31 steps)
    stepCountShift: 3,
  },
};

/**
 * Parse IMU flags byte into individual components
 */
export function parseImuFlags(flagsByte: number) {
  return {
    fallDetected: (flagsByte & (1 << WIFI_CONFIG.imuFlags.fallDetected)) !== 0,
    stairsDetected: (flagsByte & (1 << WIFI_CONFIG.imuFlags.stairsDetected)) !== 0,
    roughSurface: (flagsByte & (1 << WIFI_CONFIG.imuFlags.roughSurface)) !== 0,
    stepCount: (flagsByte & WIFI_CONFIG.imuFlags.stepCountMask) >> WIFI_CONFIG.imuFlags.stepCountShift,
  };
}
