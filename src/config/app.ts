/**
 * Aura Guardian - App Configuration
 * Contains app-wide constants, names, and version info
 */

export const APP_CONFIG = {
  // App Identity
  name: 'Aura Guardian',
  version: '2.0.0',
  tagline: 'Navigate with Confidence',
  packageName: 'com.auraguardian.app',
  
  // Device Settings
  minAndroidSdk: 21,
  
  // Wi-Fi Timing
  wifiDiscoveryTimeout: 10000, // 10 seconds
  wifiReconnectBaseDelay: 1000, // 1 second base for exponential backoff
  wifiReconnectMaxDelay: 30000, // 30 seconds max
  wifiPollInterval: 100, // 100ms sensor data interval
  
  // Sensor Thresholds (in cm)
  distanceThresholds: {
    danger: 30,      // <30cm = URGENT
    close: 100,      // 30-100cm = Strong warning
    medium: 200,     // 100-200cm = Medium warning
    far: 300,        // 200-300cm = Soft warning
    clear: 400,      // >400cm = Clear
  },
  
  // Battery Thresholds
  batteryLow: 20,
  batteryCritical: 10,
  
  // Supported Languages
  languages: ['en', 'hi', 'ta', 'te', 'kn'] as const,
  
  // Current Date (for the app context)
  currentDate: 'March 2026',
};

export type SupportedLanguage = typeof APP_CONFIG.languages[number];
