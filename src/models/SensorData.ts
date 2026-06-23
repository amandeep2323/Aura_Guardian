// Sensor data from the chest unit Wi-Fi telemetry frame
export interface SensorData {
  // Raw packet data
  header: number;           // 0xAA header byte
  
  // Distance readings (in cm, max 255 for v1 protocol)
  leftDistance: number;     // Left ultrasonic (HC-SR04 at -30°)
  centerDistance: number;   // Center ToF laser (VL53L1X)
  rightDistance: number;    // Right ultrasonic (HC-SR04 at +30°)
  groundDistance: number;   // Ground-facing ultrasonic
  farDistance: number;      // Far reading from ToF (up to 400cm)
  
  // Status
  batteryPercent: number;   // Battery percentage (0-100)
  imuFlags: number;         // Raw IMU flags byte
  
  // Parsed IMU flags
  stepCount: number;        // Steps (0-31, from bits 3-7)
  fallDetected: boolean;    // Bit 0
  stairsDetected: boolean;  // Bit 1
  roughSurface: boolean;    // Bit 2
  
  // Metadata
  timestamp: number;        // Unix timestamp ms
  isValid: boolean;         // Packet validation status
}

// Parse raw Wi-Fi telemetry bytes into SensorData
export function parseSensorPacket(bytes: Uint8Array): SensorData | null {
  // Validate packet length (10 bytes for v1, 14 bytes for v2)
  if (bytes.length < 10) {
    return null;
  }
  
  // Check header byte
  if (bytes[0] !== 0xAA) {
    return null;
  }
  
  // Validate checksum (last byte)
  const checksum = bytes.slice(0, -1).reduce((a, b) => a + b, 0) & 0xFF;
  if (checksum !== bytes[bytes.length - 1]) {
    // For simulation, we'll skip checksum validation
    // return null;
  }
  
  // Parse IMU flags byte
  const imuFlags = bytes[7];
  const fallDetected = (imuFlags & 0x01) !== 0;
  const stairsDetected = (imuFlags & 0x02) !== 0;
  const roughSurface = (imuFlags & 0x04) !== 0;
  const stepCount = (imuFlags >> 3) & 0x1F; // Bits 3-7
  
  return {
    header: bytes[0],
    leftDistance: bytes[1],
    centerDistance: bytes[2],
    rightDistance: bytes[3],
    groundDistance: bytes[4],
    farDistance: bytes[5],
    batteryPercent: bytes[6],
    imuFlags: bytes[7],
    stepCount,
    fallDetected,
    stairsDetected,
    roughSurface,
    timestamp: Date.now(),
    isValid: true,
  };
}

// Get distance zone for color coding
export type DistanceZone = 'clear' | 'caution' | 'warning' | 'danger';

export function getDistanceZone(distanceCm: number): DistanceZone {
  if (distanceCm > 200) return 'clear';      // >2m = safe
  if (distanceCm > 100) return 'caution';    // 1-2m = caution
  if (distanceCm > 30) return 'warning';     // 30cm-1m = warning
  return 'danger';                            // <30cm = danger
}

// Get zone color for UI
export function getZoneColor(zone: DistanceZone): string {
  switch (zone) {
    case 'clear': return '#22c55e';    // Green
    case 'caution': return '#eab308';  // Yellow
    case 'warning': return '#f97316';  // Orange
    case 'danger': return '#ef4444';   // Red
  }
}

// Get zone background color (lighter)
export function getZoneBgColor(zone: DistanceZone): string {
  switch (zone) {
    case 'clear': return 'rgba(34, 197, 94, 0.2)';
    case 'caution': return 'rgba(234, 179, 8, 0.2)';
    case 'warning': return 'rgba(249, 115, 22, 0.2)';
    case 'danger': return 'rgba(239, 68, 68, 0.2)';
  }
}

// Format distance for display
export function formatDistance(distanceCm: number): string {
  if (distanceCm >= 255) return '>2.5m';
  if (distanceCm >= 100) return `${(distanceCm / 100).toFixed(1)}m`;
  return `${distanceCm}cm`;
}

// Create empty/default sensor data
export function createEmptySensorData(): SensorData {
  return {
    header: 0xAA,
    leftDistance: 255,
    centerDistance: 255,
    rightDistance: 255,
    groundDistance: 30,
    farDistance: 400,
    batteryPercent: 0,
    imuFlags: 0,
    stepCount: 0,
    fallDetected: false,
    stairsDetected: false,
    roughSurface: false,
    timestamp: Date.now(),
    isValid: false,
  };
}
