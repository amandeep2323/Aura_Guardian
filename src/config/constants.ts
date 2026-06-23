/**
 * Aura Guardian - Constants
 * Distance thresholds, timing constants, and other app-wide values
 */

// Distance thresholds in centimeters
export const DISTANCE_THRESHOLDS = {
  DANGER: 30,      // <30cm = Immediate danger
  CLOSE: 100,      // 30-100cm = Close obstacle
  MEDIUM: 200,     // 100-200cm = Medium distance
  FAR: 300,        // 200-300cm = Far obstacle
  CLEAR: 400,      // >400cm = Clear path
  MAX_SENSOR: 255, // Max value for single byte (v1 protocol)
  MAX_TOF: 400,    // VL53L1X max range in cm
};

// Wi-Fi timing constants in milliseconds
export const WIFI_TIMING = {
  SCAN_DURATION: 10000,
  NOTIFY_INTERVAL: 100,
  RECONNECT_BASE: 1000,
  RECONNECT_MAX: 30000,
  RSSI_UPDATE_INTERVAL: 5000,
  CONNECTION_TIMEOUT: 15000,
};

// GPS timing constants in milliseconds
export const GPS_TIMING = {
  ACTIVE_INTERVAL: 1000,      // 1Hz when walking
  IDLE_INTERVAL: 10000,       // 0.1Hz when stationary
  ACCURACY_THRESHOLD: 20,     // meters
};

// Battery thresholds in percentage
export const BATTERY_THRESHOLDS = {
  LOW: 20,
  CRITICAL: 10,
  POWER_SAVE_TRIGGER: 15,
};

// UI constants
export const UI_CONSTANTS = {
  MIN_TOUCH_TARGET: 48,       // dp - minimum
  PREFERRED_TOUCH_TARGET: 64, // dp - preferred for primary actions
  SENSOR_HISTORY_LENGTH: 30,  // seconds of history to keep
  MAX_GRAPH_POINTS: 100,      // points in live graph
};

// Sensor names for display
export const SENSOR_NAMES = {
  left: 'Left (-30°)',
  center: 'Center',
  right: 'Right (+30°)',
  ground: 'Ground',
  far: 'Far (ToF)',
};

// Device types
export const DEVICE_TYPES = {
  CHEST: 'chest',
  LEFT_BAND: 'left_band',
  RIGHT_BAND: 'right_band',
  HEADPHONES: 'headphones',
} as const;

export type DeviceType = typeof DEVICE_TYPES[keyof typeof DEVICE_TYPES];

// Connection states
export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  SCANNING: 'scanning',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
} as const;

export type ConnectionState = typeof CONNECTION_STATES[keyof typeof CONNECTION_STATES];

// User roles
export const USER_ROLES = {
  USER: 'user',
  GUARDIAN: 'guardian',
} as const;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];

// Obstacle types
export const OBSTACLE_TYPES = [
  'pothole',
  'parked_car',
  'construction',
  '2wheeler',
  'vendor',
  'pedestrian_zone',
  'staircase',
  'misc',
] as const;

export type ObstacleType = typeof OBSTACLE_TYPES[number];

// SOS trigger types
export const SOS_TRIGGERS = [
  'voice',
  'button',
  'fall',
  'inactivity',
  'manual',
] as const;

export type SosTriggerType = typeof SOS_TRIGGERS[number];
