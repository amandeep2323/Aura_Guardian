import React, { useState, useEffect, useCallback, useRef } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { onValue, push, ref, remove, set, update } from 'firebase/database';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { auth, db } from './config/firebase';
import { registerGuardianPushToken, subscribeForegroundPushMessages } from '@/config/firebaseMessaging';
import { LANGUAGE_LABELS, toLanguage, translateText, type AppLanguage } from './config/i18n';
import AuthScreen from './features/auth/AuthScreen';
import type { AppRole } from './features/auth/types';
import UserHomePanel from './features/user/UserHomePanel';
import GuardianHomePanel from './features/guardian/GuardianHomePanel';
import LeafletMapPanel from './features/maps/LeafletMapPanel';

// ============================================================================
// AURA GUARDIAN v2.0 - PHASE 2: Device Dashboard + Sensor Live View
// ============================================================================

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface SensorData {
  timestamp: number;
  left: number;
  center: number;
  right: number;
  ground: number;
  far: number;
  battery: number;
  tof: {
    valid: boolean;
    rawMm: number | null;
    usingFallback: boolean;
  };
  imu: {
    live: boolean;
    accelX: number;
    accelY: number;
    accelZ: number;
    accelMag: number;
  };
  environment: {
    temperature: number | null;
    humidity: number | null;
    dhtLive: boolean;
    dhtTempValid: boolean;
    dhtHumValid: boolean;
  };
  imuFlags: {
    fallDetected: boolean;
    stairsDetected: boolean;
    roughSurface: boolean;
    stepCount: number;
  };
  rawPacket: number[];
}

interface Device {
  id: string;
  name: string;
  type: 'chest' | 'left_band' | 'right_band';
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  battery: number;
  rssi: number;
  lastSeen: number;
  firmwareVersion: string;
  healthScore: number;
  errorCount: number;
  reconnectAttempts: number;
  packetLoss: number;
  latency: number;
}

interface DeviceLog {
  id: string;
  timestamp: number;
  deviceId: string;
  deviceType: 'chest' | 'left_band' | 'right_band' | 'headphones';
  eventType: 'connected' | 'disconnected' | 'error' | 'low_battery' | 'firmware' | 'reconnecting' | 'packet_loss';
  message: string;
  batteryAtEvent?: number;
}

interface Trip {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  distance: number;
  duration: number;
  obstaclesDetected: number;
  safetyScore: number;
  routeName: string;
}

type ActiveTripState = {
  id: string;
  startAt: number;
  lastLocation: UserLocation | null;
  distanceM: number;
  obstacles: number;
  lastObstacleAt: number;
  fallDetected: boolean;
  routeName: string;
};

interface SavedLocation {
  id: string;
  name: string;
  address: string;
  icon: string;
  category: string;
}

interface UserLocation {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

interface EmergencyContact {
  name: string;
  phone: string;
  email: string;
}

interface GeofenceState {
  enabled: boolean;
  radiusM: number;
  center: UserLocation | null;
  inside: boolean;
}

interface NavigationSession {
  active: boolean;
  destination: {
    lat: number;
    lng: number;
    label: string;
  } | null;
  startedByGuardianUid: string;
  updatedAt: number;
}

interface LiveFeedEnvelope {
  userUid: string;
  userName: string;
  updatedAt: number;
  deviceConnected: boolean;
  leftConnected?: boolean;
  rightConnected?: boolean;
  sensorData: SensorData | null;
  location: UserLocation | null;
  geofence: GeofenceState;
  navigation: NavigationSession | null;
}

interface AuraNavigationPlugin {
  startWalkingNavigation(options: {
    destinationLat: number;
    destinationLng: number;
    destinationLabel?: string;
    originLat?: number;
    originLng?: number;
  }): Promise<{ started: boolean }>;
  stopNavigation(): Promise<{ stopped: boolean }>;
  isNavigationActive(): Promise<{ active: boolean }>;
}

const AuraNavigation = registerPlugin<AuraNavigationPlugin>('AuraNavigation');

// ============================================================================
// CONSTANTS
// ============================================================================

const WEB_SERIAL_BAUD_RATE = 115200;
const SERIAL_STALE_TIMEOUT_MS = 5000;
const WIFI_STALE_TIMEOUT_MS = 12000;
const WIFI_POLL_INTERVAL_MS = 250;
const WIFI_REQUEST_TIMEOUT_MS = 1800;
const WIFI_SSID = 'nick';
const WIFI_PASSWORD = '12345678';
const WIFI_STATUS_PATH = '/api/system/status';
const WIFI_SENSOR_POLL_PATH = '/api/sensor/current';
const WIFI_HOST_CANDIDATES = ['192.168.137.250', 'esp32-910960.local', 'esp32-910960', 'esp32.local', '192.168.137.69'];
const ROLE_HINT_STORAGE_KEY = 'auraguard_role_hint';
const LIVE_FEED_PATH = 'liveFeeds';
const LIVE_FEED_STALE_MS = 12000;
const NAVIGATION_PATH = 'navigationSessions';
const GUARDIAN_LINKS_PATH = 'guardianLinks';
const GUARDIAN_ALERTS_PATH = 'guardianAlerts';
const GEOFENCE_DEFAULT_RADIUS_M = 300;
const GUARDIAN_NOTIFY_COOLDOWN_MS = 7000;

type ConnectionMode = 'wired' | 'wifi';

const normalizeHostInput = (value: string): string => {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^wss?:\/\//i, '')
    .replace(/\/.*/, '');
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const getWifiFailureHint = (message: string): string => {
  const lower = message.toLowerCase();

  if (lower.includes('failed to fetch') || lower.includes('network request failed')) {
    return 'Check chest IP in Wi-Fi Host Override (use exact IP), and rebuild Android app with cleartext HTTP enabled.';
  }

  if (lower.includes('http polling failed')) {
    return 'Chest API responded but returned non-200. Verify chest firmware API path and Wi-Fi network.';
  }

  if (lower.includes('invalid telemetry payload')) {
    return 'Chest endpoint reachable but payload format is unexpected. Reflash latest chest firmware.';
  }

  return 'Ensure phone and chest are on same hotspot and host override is set to chest IP.';
};

const DISTANCE_ZONES = {
  SAFE: { min: 200, color: '#10b981', label: 'Safe' },
  CAUTION: { min: 100, color: '#f59e0b', label: 'Caution' },
  WARNING: { min: 30, color: '#f97316', label: 'Warning' },
  DANGER: { min: 0, color: '#ef4444', label: 'Danger' },
} as const;

const HAPTIC_PATTERNS = [
  { id: 0x00, name: 'Clear Path', description: 'Safe to proceed', leftAction: 'Off', rightAction: 'Off' },
  { id: 0x01, name: 'Obstacle Left', description: 'Go right', leftAction: '2 short pulses', rightAction: '—' },
  { id: 0x02, name: 'Obstacle Right', description: 'Go left', leftAction: '—', rightAction: '2 short pulses' },
  { id: 0x03, name: 'Obstacle Ahead', description: 'Stop', leftAction: '1 long pulse', rightAction: '1 long pulse' },
  { id: 0x04, name: 'Danger Close', description: 'Urgent <30cm', leftAction: 'Rapid vibration', rightAction: 'Rapid vibration' },
  { id: 0x05, name: 'Drop Left', description: 'Pothole/drop left', leftAction: '3 short pulses', rightAction: '—' },
  { id: 0x06, name: 'Drop Right', description: 'Pothole/drop right', leftAction: '—', rightAction: '3 short pulses' },
  { id: 0x07, name: 'Low Battery', description: 'Battery warning', leftAction: 'Heartbeat', rightAction: 'Heartbeat' },
  { id: 0x08, name: 'Shift Left', description: 'Guidance left', leftAction: 'Gentle rhythmic', rightAction: '—' },
  { id: 0x09, name: 'Shift Right', description: 'Guidance right', leftAction: '—', rightAction: 'Gentle rhythmic' },
];

const SENSOR_HISTORY_LENGTH = 300; // 30 seconds at 10Hz
const TRIP_OBSTACLE_DISTANCE_CM = 100;
const TRIP_OBSTACLE_COOLDOWN_MS = 2000;
const TRIP_STORE_LIMIT = 50;
const SOS_HOLD_MS = 5000;
const SOS_COOLDOWN_MS = 20000;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const getDistanceZone = (distance: number) => {
  if (distance >= DISTANCE_ZONES.SAFE.min) return DISTANCE_ZONES.SAFE;
  if (distance >= DISTANCE_ZONES.CAUTION.min) return DISTANCE_ZONES.CAUTION;
  if (distance >= DISTANCE_ZONES.WARNING.min) return DISTANCE_ZONES.WARNING;
  return DISTANCE_ZONES.DANGER;
};

const formatDistance = (cm: number): string => {
  if (cm >= 100) return `${(cm / 100).toFixed(1)}m`;
  return `${cm}cm`;
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toISOString().slice(0, 10);
};

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

const toRadians = (value: number): number => (value * Math.PI) / 180;

const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const earthRadius = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const parseLatLngInput = (input: string): { lat: number; lng: number } | null => {
  const cleaned = input.trim();
  const parts = cleaned.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return { lat, lng };
};

type DestinationSuggestion = {
  lat: number;
  lng: number;
  label: string;
};

const extractMapplsCandidates = (
  payload: Record<string, unknown>,
  fallbackLabel: string
): DestinationSuggestion[] => {
  const features = Array.isArray(payload.features) ? payload.features : [];

  return features.map((candidate) => {
    const item = candidate as Record<string, unknown>;
    const geometry = item.geometry as { coordinates?: [number, number] } | undefined;
    const coordinates = geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const props = (item.properties ?? {}) as Record<string, unknown>;
    const labelSource = props.name
      ?? props.street
      ?? props.city
      ?? props.state
      ?? props.country
      ?? fallbackLabel;

    return {
      lat,
      lng,
      label: String(labelSource),
    } satisfies DestinationSuggestion;
  }).filter((item): item is DestinationSuggestion => item !== null);
};

const fetchMapplsCandidates = async (
  query: string,
  _mapKey: string,
  limit: number
): Promise<DestinationSuggestion[]> => {
  const cleanedQuery = query.trim().replace(/\s+/g, ' ');
  if (!cleanedQuery) return [];

  const photonTask = (async () => {
    const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(cleanedQuery)}&limit=${limit}&lang=en`);
    if (!response.ok) return [] as DestinationSuggestion[];
    const payload = await response.json() as Record<string, unknown>;
    return extractMapplsCandidates(payload, cleanedQuery);
  })();

  const nominatimTask = (async () => {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&addressdetails=1&accept-language=en&q=${encodeURIComponent(cleanedQuery)}`
    );
    if (!response.ok) return [] as DestinationSuggestion[];

    const payload = await response.json() as Array<Record<string, unknown>>;
    return payload.map((item) => {
      const lat = Number(item.lat);
      const lng = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const label = String(item.display_name ?? item.name ?? cleanedQuery);
      return { lat, lng, label } satisfies DestinationSuggestion;
    }).filter((item): item is DestinationSuggestion => item !== null);
  })();

  const [photonResult, nominatimResult] = await Promise.allSettled([photonTask, nominatimTask]);
  const merged = [
    ...(photonResult.status === 'fulfilled' ? photonResult.value : []),
    ...(nominatimResult.status === 'fulfilled' ? nominatimResult.value : []),
  ];

  const deduped: DestinationSuggestion[] = [];
  const seen = new Set<string>();

  merged.forEach((item) => {
    const key = `${item.lat.toFixed(5)}|${item.lng.toFixed(5)}|${item.label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });

  return deduped.slice(0, limit);
};

// Used in trip display
void formatDuration;

const generateId = (): string => Math.random().toString(36).substr(2, 9);

const calculateHealthScore = (device: Device): number => {
  const batteryScore = device.battery * 0.4;
  const signalScore = Math.min(100, (device.rssi + 100) * 1.5) * 0.3;
  const reliabilityScore = Math.max(0, 100 - device.packetLoss * 10 - device.errorCount * 5) * 0.3;
  return Math.round(batteryScore + signalScore + reliabilityScore);
};

const parseSensorPacket = (packet: number[]): SensorData | null => {
  if (packet.length < 10 || packet[0] !== 0xAA) return null;
  
  const imuFlagsByte = packet[7];
  return {
    timestamp: Date.now(),
    left: packet[1],
    center: packet[2],
    right: packet[3],
    ground: packet[4],
    far: packet[5],
    battery: packet[6],
    tof: {
      valid: packet[5] < 255,
      rawMm: packet[5] * 10,
      usingFallback: false,
    },
    imu: {
      live: false,
      accelX: 0,
      accelY: 0,
      accelZ: 0,
      accelMag: 0,
    },
    environment: {
      temperature: null,
      humidity: null,
      dhtLive: false,
      dhtTempValid: false,
      dhtHumValid: false,
    },
    imuFlags: {
      fallDetected: (imuFlagsByte & 0x01) !== 0,
      stairsDetected: (imuFlagsByte & 0x02) !== 0,
      roughSurface: (imuFlagsByte & 0x04) !== 0,
      stepCount: (imuFlagsByte >> 3) & 0x1F,
    },
    rawPacket: packet,
  };
};

const toByte = (value: number, fallback: number = 0): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(255, Math.round(value)));
};

type WebSerialPort = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable?: WritableStream<Uint8Array> | null;
};

type NavigatorWithSerial = Navigator & {
  serial?: {
    requestPort: () => Promise<WebSerialPort>;
  };
};

type SerialFrameState = {
  left?: number;
  center?: number;
  right?: number;
  front?: number;
  stairsDetected?: boolean;
  roughSurface?: boolean;
  stepCount?: number;
  tofRawMm?: number;
  tofValid?: boolean;
  frontOverride?: boolean;
  imuLive?: boolean;
  accelX?: number;
  accelY?: number;
  accelZ?: number;
  accelMag?: number;
  temperature?: number;
  humidity?: number;
  dhtLive?: boolean;
  dhtTempValid?: boolean;
  dhtHumValid?: boolean;
  pattern?: number;
  intensity?: number;
  dangerLevel?: number;
  wristsConnected?: boolean;
  leftConnected?: boolean;
  rightConnected?: boolean;
  fallDetectedUntil?: number;
};

type ParsedSerialLine = {
  frame: SerialFrameState;
  sensorData: SensorData | null;
  leftConnected?: boolean;
  rightConnected?: boolean;
  sosTriggered?: boolean;
};

const isWebSerialSupported = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return 'serial' in navigator;
};

const parseDistanceValue = (line: string, label: 'LEFT' | 'CENTER' | 'RIGHT' | 'FRONT'): number | null => {
  const match = line.match(new RegExp(`${label}:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*cm`, 'i'));
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return value;
};

const buildSensorDataFromFrame = (
  frame: SerialFrameState,
  fallbackBattery: number,
  now: number
): SensorData | null => {
  if (
    !Number.isFinite(frame.left)
    || !Number.isFinite(frame.center)
    || !Number.isFinite(frame.right)
    || !Number.isFinite(frame.front)
  ) {
    return null;
  }

  const danger = toByte(frame.dangerLevel ?? 0);
  const isFallActive = (frame.fallDetectedUntil ?? 0) > now;
  const stairsDetected = frame.stairsDetected === true;
  const roughSurface = frame.roughSurface === true || danger >= 2;
  const stepCount = toByte(frame.stepCount ?? 0) & 0x1f;
  const imuFlags =
    (isFallActive ? 0x01 : 0x00)
    | (stairsDetected ? 0x02 : 0x00)
    | (roughSurface ? 0x04 : 0x00)
    | (stepCount << 3);

  const packet = [
    0xAA,
    toByte(frame.left as number),
    toByte(frame.center as number),
    toByte(frame.right as number),
    toByte(frame.front as number),
    toByte(frame.center as number),
    toByte(fallbackBattery, 85),
    toByte(imuFlags),
    toByte(frame.pattern ?? 0),
    0,
  ];

  packet[9] = packet.slice(1, 9).reduce((acc, item) => acc ^ item, 0);
  const parsed = parseSensorPacket(packet);
  if (!parsed) return null;

  return {
    ...parsed,
    timestamp: now,
    tof: {
      valid: frame.tofValid ?? parsed.tof.valid,
      rawMm: Number.isFinite(frame.tofRawMm) ? Number(frame.tofRawMm) : parsed.tof.rawMm,
      usingFallback: frame.frontOverride === true || frame.tofValid === false,
    },
    imu: {
      live: frame.imuLive === true,
      accelX: Number.isFinite(frame.accelX) ? Number(frame.accelX) : 0,
      accelY: Number.isFinite(frame.accelY) ? Number(frame.accelY) : 0,
      accelZ: Number.isFinite(frame.accelZ) ? Number(frame.accelZ) : 0,
      accelMag: Number.isFinite(frame.accelMag) ? Number(frame.accelMag) : 0,
    },
    environment: {
      temperature: Number.isFinite(frame.temperature) ? Number(frame.temperature) : null,
      humidity: Number.isFinite(frame.humidity) ? Number(frame.humidity) : null,
      dhtLive: frame.dhtLive === true,
      dhtTempValid: frame.dhtTempValid === true,
      dhtHumValid: frame.dhtHumValid === true,
    },
    rawPacket: packet,
  };
};

const parseSerialLine = (
  rawLine: string,
  previousFrame: SerialFrameState,
  fallbackBattery: number
): ParsedSerialLine => {
  const line = rawLine.trim();
  if (!line) {
    return { frame: previousFrame, sensorData: null };
  }

  const now = Date.now();
  const frame: SerialFrameState = { ...previousFrame };
  let shouldEmitSensor = false;
  let leftConnected: boolean | undefined;
  let rightConnected: boolean | undefined;
  let sosTriggered: boolean | undefined;

  const jsonStart = line.indexOf('{');
  if (jsonStart >= 0 && line.endsWith('}')) {
    try {
      const parsed = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;

      const leftValue = Number(parsed.left ?? parsed.left_cm);
      const centerValue = Number(parsed.center ?? parsed.center_cm);
      const rightValue = Number(parsed.right ?? parsed.right_cm);
      const frontValue = Number(parsed.front ?? parsed.front_cm);
      const tofRawMmValue = Number(parsed.tofRawMm ?? parsed.tof_raw_mm);
      const accelXValue = Number(parsed.accelX);
      const accelYValue = Number(parsed.accelY);
      const accelZValue = Number(parsed.accelZ);
      const accelMagValue = Number(parsed.accelMag);
      const temperatureValue = Number(parsed.temperature ?? parsed.temp);
      const humidityValue = Number(parsed.humidity);

      if (Number.isFinite(leftValue)) { frame.left = leftValue; shouldEmitSensor = true; }
      if (Number.isFinite(centerValue)) { frame.center = centerValue; shouldEmitSensor = true; }
      if (Number.isFinite(rightValue)) { frame.right = rightValue; shouldEmitSensor = true; }
      if (Number.isFinite(frontValue)) { frame.front = frontValue; shouldEmitSensor = true; }

      const patternValue = Number(parsed.pattern);
      const intensityValue = Number(parsed.intensity);
      const dangerValue = Number(parsed.dangerLevel ?? parsed.danger);
      const stepCountValue = Number(parsed.stepCount);

      if (Number.isFinite(patternValue)) frame.pattern = patternValue;
      if (Number.isFinite(intensityValue)) frame.intensity = intensityValue;
      if (Number.isFinite(dangerValue)) frame.dangerLevel = dangerValue;
      if (Number.isFinite(stepCountValue)) frame.stepCount = stepCountValue;
      if (Number.isFinite(tofRawMmValue)) frame.tofRawMm = tofRawMmValue;
      if (Number.isFinite(accelXValue)) frame.accelX = accelXValue;
      if (Number.isFinite(accelYValue)) frame.accelY = accelYValue;
      if (Number.isFinite(accelZValue)) frame.accelZ = accelZValue;
      if (Number.isFinite(accelMagValue)) frame.accelMag = accelMagValue;
      if (Number.isFinite(temperatureValue)) frame.temperature = temperatureValue;
      if (Number.isFinite(humidityValue)) frame.humidity = humidityValue;

      if (typeof parsed.tofValid === 'boolean') {
        frame.tofValid = parsed.tofValid;
      }

      if (typeof parsed.frontOverride === 'boolean') {
        frame.frontOverride = parsed.frontOverride;
      }

      if (typeof parsed.imuLive === 'boolean') {
        frame.imuLive = parsed.imuLive;
      }

      if (typeof parsed.stairsDetected === 'boolean') {
        frame.stairsDetected = parsed.stairsDetected;
      }

      if (typeof parsed.roughSurface === 'boolean') {
        frame.roughSurface = parsed.roughSurface;
      }

      if (typeof parsed.dhtLive === 'boolean') {
        frame.dhtLive = parsed.dhtLive;
      }

      if (typeof parsed.dhtTempValid === 'boolean') {
        frame.dhtTempValid = parsed.dhtTempValid;
      }

      if (typeof parsed.dhtHumValid === 'boolean') {
        frame.dhtHumValid = parsed.dhtHumValid;
      }

      const leftField = parsed.leftConnected;
      const rightField = parsed.rightConnected;
      if (typeof leftField === 'boolean') {
        leftConnected = leftField;
        frame.leftConnected = leftField;
      }
      if (typeof rightField === 'boolean') {
        rightConnected = rightField;
        frame.rightConnected = rightField;
      }
      if (typeof parsed.wristsConnected === 'boolean' && leftConnected === undefined && rightConnected === undefined) {
        leftConnected = parsed.wristsConnected;
        rightConnected = parsed.wristsConnected;
        frame.leftConnected = parsed.wristsConnected;
        frame.rightConnected = parsed.wristsConnected;
      }

      if (parsed.fallDetected === true) {
        frame.fallDetectedUntil = now + 5000;
        shouldEmitSensor = true;
      }

      if (parsed.sosTriggered === true) {
        sosTriggered = true;
      }
    } catch {
      // Ignore malformed JSON and continue with line-based parsing.
    }
  }

  const left = parseDistanceValue(line, 'LEFT');
  if (left !== null) {
    frame.left = left;
    shouldEmitSensor = true;
  }

  const center = parseDistanceValue(line, 'CENTER');
  if (center !== null) {
    frame.center = center;
    shouldEmitSensor = true;
  }

  const right = parseDistanceValue(line, 'RIGHT');
  if (right !== null) {
    frame.right = right;
    shouldEmitSensor = true;
  }

  const front = parseDistanceValue(line, 'FRONT');
  if (front !== null) {
    frame.front = front;
    shouldEmitSensor = true;
  }

  const hapticMatch = line.match(/Haptic:\s*P=0x([0-9a-fA-F]+)\s*I=(\d+)\s*\|\s*Danger:(\d+)/i);
  if (hapticMatch) {
    frame.pattern = parseInt(hapticMatch[1], 16);
    frame.intensity = Number(hapticMatch[2]);
    frame.dangerLevel = Number(hapticMatch[3]);
    shouldEmitSensor = true;
  }

  const wristMatch = line.match(/Wrists:\s*left=(Connected|Disconnected)\s*right=(Connected|Disconnected)/i);
  if (wristMatch) {
    leftConnected = wristMatch[1].toLowerCase() === 'connected';
    rightConnected = wristMatch[2].toLowerCase() === 'connected';
    frame.leftConnected = leftConnected;
    frame.rightConnected = rightConnected;
  } else {
    const fallbackMatch = line.match(/Wrists:\s*(Connected|No response)/i);
    if (fallbackMatch) {
      const connected = fallbackMatch[1].toLowerCase() === 'connected';
      leftConnected = connected;
      rightConnected = connected;
      frame.leftConnected = connected;
      frame.rightConnected = connected;
    }
  }

  if (/FALL\s+DETECTED/i.test(line)) {
    frame.fallDetectedUntil = now + 5000;
    shouldEmitSensor = true;
  }

  if ((frame.fallDetectedUntil ?? 0) <= now) {
    frame.fallDetectedUntil = undefined;
  }

  const sensorData = shouldEmitSensor ? buildSensorDataFromFrame(frame, fallbackBattery, now) : null;

  return {
    frame,
    sensorData,
    leftConnected,
    rightConnected,
    sosTriggered,
  };
};

const parseJsonObjectFromLine = (line: string): Record<string, unknown> | null => {
  const jsonStart = line.indexOf('{');
  const jsonEnd = line.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < jsonStart) return null;

  try {
    return JSON.parse(line.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const readNumericField = (payload: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = Number(payload[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
};

const parseWifiTelemetry = (
  rawLine: string,
  fallbackBattery: number,
): { sensorData: SensorData | null; leftConnected?: boolean; rightConnected?: boolean; sosTriggered?: boolean } => {
  const payload = parseJsonObjectFromLine(rawLine);
  if (!payload) {
    return { sensorData: null };
  }

  const left = readNumericField(payload, ['left', 'left_cm']);
  const center = readNumericField(payload, ['center', 'center_cm']);
  const right = readNumericField(payload, ['right', 'right_cm']);
  const front = readNumericField(payload, ['front', 'front_cm', 'ground', 'ground_cm']);
  const far = readNumericField(payload, ['far', 'far_cm']);
  const battery = readNumericField(payload, ['battery', 'batteryPercent', 'battery_percent']);

  if (left === null || center === null || right === null) {
    return { sensorData: null };
  }

  const danger = toByte(readNumericField(payload, ['dangerLevel', 'danger']) ?? 0);
  const fallDetected = payload.fallDetected === true;
  const roughSurface = payload.roughSurface === true;
  const stairsDetected = payload.stairsDetected === true;
  const stepCount = toByte(readNumericField(payload, ['stepCount']) ?? 0) & 0x1f;
  const tofValid = payload.tofValid === true;
  const tofRawMm = readNumericField(payload, ['tofRawMm', 'tof_raw_mm']);
  const frontOverride = payload.frontOverride === true;
  const imuLive = payload.imuLive === true;
  const accelX = readNumericField(payload, ['accelX']);
  const accelY = readNumericField(payload, ['accelY']);
  const accelZ = readNumericField(payload, ['accelZ']);
  const accelMag = readNumericField(payload, ['accelMag']);
  const temperature = readNumericField(payload, ['temperature', 'temp']);
  const humidity = readNumericField(payload, ['humidity']);
  const dhtLive = payload.dhtLive === true;
  const dhtTempValid = payload.dhtTempValid === true;
  const dhtHumValid = payload.dhtHumValid === true;
  const sosTriggered = payload.sosTriggered === true;

  const imuFlags =
    (fallDetected ? 0x01 : 0x00)
    | (stairsDetected ? 0x02 : 0x00)
    | (roughSurface || danger >= 2 ? 0x04 : 0x00)
    | (stepCount << 3);

  const packet = [
    0xAA,
    toByte(left),
    toByte(center),
    toByte(right),
    toByte(front ?? center),
    toByte(far ?? center),
    toByte(battery ?? fallbackBattery, 85),
    toByte(imuFlags),
    0,
    0,
  ];
  packet[9] = packet.slice(1, 9).reduce((acc, item) => acc ^ item, 0);

  const sensorData = parseSensorPacket(packet);
  const leftConnected = typeof payload.leftConnected === 'boolean'
    ? payload.leftConnected
    : (typeof payload.wristsConnected === 'boolean' ? payload.wristsConnected : undefined);
  const rightConnected = typeof payload.rightConnected === 'boolean'
    ? payload.rightConnected
    : (typeof payload.wristsConnected === 'boolean' ? payload.wristsConnected : undefined);

  if (!sensorData) {
    return {
      sensorData: null,
      leftConnected,
      rightConnected,
    };
  }

  return {
    sensorData: {
      ...sensorData,
      tof: {
        valid: tofValid,
        rawMm: tofRawMm,
        usingFallback: !tofValid || frontOverride,
      },
      imu: {
        live: imuLive,
        accelX: accelX ?? 0,
        accelY: accelY ?? 0,
        accelZ: accelZ ?? 0,
        accelMag: accelMag ?? 0,
      },
      environment: {
        temperature,
        humidity,
        dhtLive,
        dhtTempValid,
        dhtHumValid,
      },
    },
    leftConnected,
    rightConnected,
    sosTriggered,
  };
};

// ============================================================================
// CUSTOM HOOKS
// ============================================================================

const useLocalStorage = <T,>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue: React.Dispatch<React.SetStateAction<T>> = (value) => {
    setStoredValue((currentValue) => {
      const nextValue = typeof value === 'function'
        ? (value as (previousValue: T) => T)(currentValue)
        : value;

      window.localStorage.setItem(key, JSON.stringify(nextValue));
      return nextValue;
    });
  };

  return [storedValue, setValue];
};

// Export for future use
void useLocalStorage;

// ============================================================================
// SAVED LOCATIONS (optional defaults)
// ============================================================================

const DEMO_LOCATIONS: SavedLocation[] = [
  { id: '1', name: 'Home', address: '42 Gandhi Nagar, Chennai', icon: '🏠', category: 'home' },
  { id: '2', name: 'Office', address: 'Tech Park, OMR Road', icon: '🏢', category: 'work' },
  { id: '3', name: 'Apollo Hospital', address: 'Greams Road', icon: '🏥', category: 'medical' },
  { id: '4', name: 'Central Metro', address: 'Chennai Central', icon: '🚇', category: 'transit' },
];

// Export for future use
void DEMO_LOCATIONS;

// ============================================================================
// SVG ICONS
// ============================================================================

const Icons = {
  Home: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9,22 9,12 15,12 15,22" />
    </svg>
  ),
  Devices: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
    </svg>
  ),
  Sensors: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2a10 10 0 0 1 10 10M12 2a10 10 0 0 0-10 10M12 22a10 10 0 0 1-10-10M12 22a10 10 0 0 0 10-10" />
      <circle cx="12" cy="12" r="6" strokeDasharray="2 2" />
    </svg>
  ),
  Settings: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Battery: ({ level }: { level: number }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="6" width="18" height="12" rx="2" />
      <path d="M23 10v4" />
      <rect x="3" y="8" width={Math.max(0, (level / 100) * 14)} height="8" fill="currentColor" rx="1" />
    </svg>
  ),
  Signal: ({ strength }: { strength: number }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="16" width="4" height="6" fill={strength >= 1 ? 'currentColor' : 'none'} rx="1" />
      <rect x="8" y="12" width="4" height="10" fill={strength >= 2 ? 'currentColor' : 'none'} rx="1" />
      <rect x="14" y="8" width="4" height="14" fill={strength >= 3 ? 'currentColor' : 'none'} rx="1" />
      <rect x="20" y="4" width="4" height="18" fill={strength >= 4 ? 'currentColor' : 'none'} rx="1" />
    </svg>
  ),
  Walking: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="4" r="2" />
      <path d="M15 22v-6l-3-3 2-4 3 1v4" />
      <path d="M9 22l2-8-2-2" />
      <path d="M6 13l4-2" />
    </svg>
  ),
  AlertTriangle: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Phone: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  Mic: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  Refresh: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  ChevronRight: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  Clock: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Activity: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  Logs: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  Heart: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  Wifi: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  ),
  Zap: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Shield: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  Cpu: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  ),
  Eye: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  TrendingUp: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  TrendingDown: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  ),
  Map: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  ),
  ArrowLeft: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  Play: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  ),
  Pause: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  ),
  BarChart: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
};

// ============================================================================
// COMPONENTS
// ============================================================================

// Line Chart Component for Real-time Sensor Data
const LineChart: React.FC<{
  data: number[];
  color: string;
  height?: number;
  maxValue?: number;
  minValue?: number;
  label?: string;
  showGrid?: boolean;
  animate?: boolean;
  valueSuffix?: string;
}> = ({ data, color, height = 120, maxValue = 400, minValue = 0, label, showGrid = true, animate = true, valueSuffix = 'cm' }) => {
  const width = 260;
  const padding = { top: 14, right: 18, bottom: 26, left: 46 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  const points = data.map((value, index) => {
    const x = padding.left + (index / (data.length - 1 || 1)) * chartWidth;
    const y = padding.top + chartHeight - ((value - minValue) / (maxValue - minValue)) * chartHeight;
    return { x, y, value };
  });
  
  const pathD = points.length > 1
    ? `M ${points[0].x} ${points[0].y} ${points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')}`
    : '';
  
  const areaD = points.length > 1
    ? `${pathD} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`
    : '';

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => ({
    y: padding.top + chartHeight * (1 - ratio),
    value: Math.round(minValue + (maxValue - minValue) * ratio),
  }));

  return (
    <div className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`gradient-${color.replace('#', '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        
        {/* Grid lines */}
        {showGrid && gridLines.map((line, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={line.y}
              x2={width - padding.right}
              y2={line.y}
              stroke="rgba(255,255,255,0.1)"
              strokeDasharray="2,2"
            />
            <text
              x={padding.left - 5}
              y={line.y + 3}
              fill="rgba(255,255,255,0.5)"
              fontSize="9"
              textAnchor="end"
            >
              {line.value}
            </text>
          </g>
        ))}
        
        {/* Area fill */}
        {areaD && (
          <path
            d={areaD}
            fill={`url(#gradient-${color.replace('#', '')})`}
            className={animate ? 'transition-all duration-100' : ''}
          />
        )}
        
        {/* Line */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={animate ? 'transition-all duration-100' : ''}
          />
        )}
        
        {/* Current value dot */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="3"
            fill={color}
            className="animate-pulse"
          />
        )}
        
        {/* Label */}
        {label && (
          <text
            x={width / 2}
            y={height - 5}
            fill="rgba(255,255,255,0.7)"
            fontSize="9"
            textAnchor="middle"
          >
            {label}
          </text>
        )}
      </svg>
      
      {/* Current value overlay */}
      {points.length > 0 && (
        <div
          className="absolute top-1 right-2 px-2 py-0.5 rounded text-xs font-mono"
          style={{ backgroundColor: color + '33', color }}
        >
          {points[points.length - 1].value.toFixed(0)} {valueSuffix}
        </div>
      )}
    </div>
  );
};

// Multi-Line Chart for All Sensors
const MultiLineChart: React.FC<{
  data: { left: number[]; center: number[]; right: number[]; ground: number[]; far: number[] };
  height?: number;
}> = ({ data, height = 200 }) => {
  const sensors = [
    { key: 'left', color: '#8b5cf6', label: 'Left' },
    { key: 'center', color: '#06b6d4', label: 'Center ToF' },
    { key: 'right', color: '#f59e0b', label: 'Right' },
    { key: 'ground', color: '#10b981', label: 'Front US' },
    { key: 'far', color: '#ec4899', label: 'ToF Raw' },
  ];

  const width = 300;
  const padding = { top: 16, right: 20, bottom: 32, left: 52 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = 400;

  return (
    <div className="relative w-full bg-gray-900/50 rounded-xl p-4" style={{ height: height + 60 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/70 text-sm font-medium">All Sensors (30s History)</span>
        <div className="flex gap-3 flex-wrap">
          {sensors.map(s => (
            <div key={s.key} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-white/50">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
      
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        {/* Grid */}
        {[0, 80, 160, 240, 320, 400].map((val, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={padding.top + chartHeight - (val / maxValue) * chartHeight}
              x2={width - padding.right}
              y2={padding.top + chartHeight - (val / maxValue) * chartHeight}
              stroke="rgba(255,255,255,0.08)"
            />
            <text
              x={padding.left - 3}
              y={padding.top + chartHeight - (val / maxValue) * chartHeight + 3}
              fill="rgba(255,255,255,0.4)"
              fontSize="9"
              textAnchor="end"
            >
              {val}
            </text>
          </g>
        ))}
        
        {/* Lines */}
        {sensors.map(sensor => {
          const sensorData = data[sensor.key as keyof typeof data] || [];
          if (sensorData.length < 2) return null;
          
          const points = sensorData.map((value, index) => ({
            x: padding.left + (index / (sensorData.length - 1)) * chartWidth,
            y: padding.top + chartHeight - (value / maxValue) * chartHeight,
          }));
          
          const pathD = `M ${points[0].x} ${points[0].y} ${points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')}`;
          
          return (
            <g key={sensor.key}>
              <path
                d={pathD}
                fill="none"
                stroke={sensor.color}
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.8"
              />
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="2"
                fill={sensor.color}
              />
            </g>
          );
        })}
        
        {/* Time labels */}
        <text x={padding.left} y={height - 8} fill="rgba(255,255,255,0.5)" fontSize="9">-30s</text>
        <text x={width / 2} y={height - 8} fill="rgba(255,255,255,0.5)" fontSize="9" textAnchor="middle">-15s</text>
        <text x={width - padding.right} y={height - 8} fill="rgba(255,255,255,0.5)" fontSize="9" textAnchor="end">Now</text>
      </svg>
    </div>
  );
};

// Radar Visualization Component
const RadarView: React.FC<{ sensorData: SensorData | null }> = ({ sensorData }) => {
  const maxDistance = 255;
  const center = 120;
  const maxRadius = 100;

  const getRadius = (distance: number) => {
    return maxRadius - (distance / maxDistance) * maxRadius;
  };

  const sensors = [
    { key: 'center', angle: -90, label: 'Front', value: sensorData?.center ?? 0 },
    { key: 'right', angle: -30, label: 'Right', value: sensorData?.right ?? 0 },
    { key: 'left', angle: -150, label: 'Left', value: sensorData?.left ?? 0 },
    { key: 'ground', angle: -90, label: 'Front US', value: sensorData?.ground ?? 0 },
    { key: 'far', angle: -90, label: 'Far', value: sensorData?.far ?? 0, isFar: true },
  ];

  return (
    <div className="relative w-full max-w-xs mx-auto aspect-square">
      <svg viewBox="0 0 240 240" className="w-full h-full">
        <defs>
          <radialGradient id="radarGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>
          {sensors.map(sensor => (
            <linearGradient
              key={`beam-${sensor.key}`}
              id={`beam-${sensor.key}`}
              gradientUnits="userSpaceOnUse"
              x1={center}
              y1={center}
              x2={center + Math.cos((sensor.angle * Math.PI) / 180) * maxRadius}
              y2={center + Math.sin((sensor.angle * Math.PI) / 180) * maxRadius}
            >
              <stop offset="0%" stopColor={getDistanceZone(sensor.value).color} stopOpacity="0.8" />
              <stop offset="100%" stopColor={getDistanceZone(sensor.value).color} stopOpacity="0.1" />
            </linearGradient>
          ))}
        </defs>

        {/* Background */}
        <circle cx={center} cy={center} r={maxRadius} fill="url(#radarGradient)" />

        {/* Range circles */}
        {[0.25, 0.5, 0.75, 1].map((ratio, i) => (
          <circle
            key={i}
            cx={center}
            cy={center}
            r={maxRadius * ratio}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="1"
            strokeDasharray={i === 3 ? "none" : "4,4"}
          />
        ))}

        {/* Sweep animation */}
        <circle
          cx={center}
          cy={center}
          r={maxRadius}
          fill="none"
          stroke="url(#radarGradient)"
          strokeWidth="40"
          strokeDasharray={`${maxRadius * 0.4} ${maxRadius * 6.28 - maxRadius * 0.4}`}
          className="animate-spin origin-center"
          style={{ animationDuration: '4s' }}
        />

        {/* Sensor beams */}
        {sensors.filter(s => !s.isFar).map(sensor => {
          const radius = getRadius(sensor.value);
          const endX = center + Math.cos((sensor.angle * Math.PI) / 180) * radius;
          const endY = center + Math.sin((sensor.angle * Math.PI) / 180) * radius;
          const zone = getDistanceZone(sensor.value);

          return (
            <g key={sensor.key}>
              {/* Beam line */}
              <line
                x1={center}
                y1={center}
                x2={endX}
                y2={endY}
                stroke={`url(#beam-${sensor.key})`}
                strokeWidth="12"
                strokeLinecap="round"
                className="transition-all duration-150"
              />
              
              {/* Endpoint dot */}
              <circle
                cx={endX}
                cy={endY}
                r="6"
                fill={zone.color}
                className="animate-pulse"
              />
              
              {/* Distance label */}
              <text
                x={center + Math.cos((sensor.angle * Math.PI) / 180) * (maxRadius + 15)}
                y={center + Math.sin((sensor.angle * Math.PI) / 180) * (maxRadius + 15)}
                fill="white"
                fontSize="10"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {formatDistance(sensor.value)}
              </text>
            </g>
          );
        })}

        {/* Center point */}
        <circle cx={center} cy={center} r="8" fill="#6366f1" />
        <circle cx={center} cy={center} r="4" fill="white" />

        {/* Direction labels */}
        <text x={center} y="20" fill="rgba(255,255,255,0.6)" fontSize="11" textAnchor="middle" fontWeight="600">FRONT</text>
        <text x="220" y={center + 4} fill="rgba(255,255,255,0.6)" fontSize="11" textAnchor="middle" fontWeight="600">RIGHT</text>
        <text x="20" y={center + 4} fill="rgba(255,255,255,0.6)" fontSize="11" textAnchor="middle" fontWeight="600">LEFT</text>
        <text x={center} y="230" fill="rgba(255,255,255,0.6)" fontSize="11" textAnchor="middle" fontWeight="600">BACK</text>
      </svg>
    </div>
  );
};

// Device Health Card Component
const DeviceHealthCard: React.FC<{
  device: Device;
  onConnect: () => void;
  onDisconnect: () => void;
  connectLabel?: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}> = ({ device, onConnect, onDisconnect, connectLabel = 'Connect', isExpanded, onToggleExpand }) => {
  const isWrist = device.type === 'left_band' || device.type === 'right_band';
  const healthColor = device.healthScore >= 70 ? '#10b981' : device.healthScore >= 40 ? '#f59e0b' : '#ef4444';
  const statusColors = {
    connected: 'bg-emerald-500',
    connecting: 'bg-amber-500 animate-pulse',
    reconnecting: 'bg-amber-500 animate-pulse',
    disconnected: 'bg-gray-500',
    error: 'bg-red-500',
  };

  const deviceIcons = {
    chest: '📡',
    left_band: '⌚',
    right_band: '⌚',
  };

  const signalStrength = Math.min(4, Math.max(1, Math.floor((device.rssi + 100) / 20)));

  return (
    <div 
      className={`bg-white/5 backdrop-blur-xl rounded-2xl border transition-all duration-300 overflow-hidden ${
        device.status === 'connected' ? 'border-emerald-500/30' : 'border-white/10'
      }`}
    >
      <div 
        className="p-4 cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-4">
          {/* Device Icon */}
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${
            device.status === 'connected' ? 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20' : 'bg-white/5'
          }`}>
            {deviceIcons[device.type]}
          </div>

          {/* Device Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white truncate">{device.name}</span>
              <span className={`w-2 h-2 rounded-full ${statusColors[device.status]}`} />
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1 text-white/50">
                <div className="w-4 h-4"><Icons.Battery level={device.battery} /></div>
                <span className="text-xs">{Math.round(device.battery)}%</span>
              </div>
              {device.status === 'connected' && (
                <>
                  <div className="flex items-center gap-1 text-white/50">
                    <div className="w-4 h-4"><Icons.Signal strength={signalStrength} /></div>
                    <span className="text-xs">{device.rssi}dBm</span>
                  </div>
                  <div className="flex items-center gap-1" style={{ color: healthColor }}>
                    <div className="w-4 h-4"><Icons.Heart /></div>
                    <span className="text-xs font-medium">{device.healthScore}%</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Connection State */}
          {isWrist ? (
            <div className={`px-4 py-2 rounded-xl text-sm font-medium ${
              device.status === 'connected'
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-white/10 text-white/60'
            }`}>
              {device.status === 'connected' ? 'Connected' : 'Disconnected'}
            </div>
          ) : device.status === 'connected' ? (
            <button
              onClick={(e) => { e.stopPropagation(); onDisconnect(); }}
              className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-colors"
            >
              Disconnect
            </button>
          ) : device.status === 'connecting' || device.status === 'reconnecting' ? (
            <div className="px-4 py-2 rounded-xl bg-amber-500/10 text-amber-400 text-sm font-medium">
              {device.status === 'reconnecting' ? `Retry ${device.reconnectAttempts}` : 'Connecting...'}
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onConnect(); }}
              className="px-4 py-2 rounded-xl bg-indigo-500/20 text-indigo-400 text-sm font-medium hover:bg-indigo-500/30 transition-colors"
            >
              {connectLabel}
            </button>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && device.status === 'connected' && (
        <div className="px-4 pb-4 border-t border-white/5 pt-4 animate-fadeIn">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 rounded-xl p-3">
              <div className="text-xs text-white/50 mb-1">Packet Loss</div>
              <div className="text-lg font-semibold text-white">{device.packetLoss.toFixed(1)}%</div>
            </div>
            <div className="bg-white/5 rounded-xl p-3">
              <div className="text-xs text-white/50 mb-1">Latency</div>
              <div className="text-lg font-semibold text-white">{device.latency}ms</div>
            </div>
            <div className="bg-white/5 rounded-xl p-3">
              <div className="text-xs text-white/50 mb-1">Firmware</div>
              <div className="text-lg font-semibold text-white">{device.firmwareVersion}</div>
            </div>
            <div className="bg-white/5 rounded-xl p-3">
              <div className="text-xs text-white/50 mb-1">Errors</div>
              <div className="text-lg font-semibold text-white">{device.errorCount}</div>
            </div>
          </div>
          
          {/* Health Score Bar */}
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-white/70">Health Score</span>
              <span className="text-sm font-semibold" style={{ color: healthColor }}>{device.healthScore}%</span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${device.healthScore}%`, backgroundColor: healthColor }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Device Log Item Component
const DeviceLogItem: React.FC<{ log: DeviceLog }> = ({ log }) => {
  const eventIcons: Record<string, React.ReactNode> = {
    connected: <div className="w-5 h-5 text-emerald-400"><Icons.Check /></div>,
    disconnected: <div className="w-5 h-5 text-red-400"><Icons.X /></div>,
    error: <div className="w-5 h-5 text-red-400"><Icons.AlertTriangle /></div>,
    low_battery: <div className="w-5 h-5 text-amber-400"><Icons.Battery level={20} /></div>,
    reconnecting: <div className="w-5 h-5 text-amber-400"><Icons.Refresh /></div>,
    packet_loss: <div className="w-5 h-5 text-orange-400"><Icons.Wifi /></div>,
  };

  const eventColors: Record<string, string> = {
    connected: 'border-emerald-500/30 bg-emerald-500/5',
    disconnected: 'border-red-500/30 bg-red-500/5',
    error: 'border-red-500/30 bg-red-500/5',
    low_battery: 'border-amber-500/30 bg-amber-500/5',
    reconnecting: 'border-amber-500/30 bg-amber-500/5',
    packet_loss: 'border-orange-500/30 bg-orange-500/5',
  };

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border ${eventColors[log.eventType] || 'border-white/10 bg-white/5'}`}>
      <div className="mt-0.5">{eventIcons[log.eventType]}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-white truncate">{log.message}</span>
          <span className="text-xs text-white/40 whitespace-nowrap">{formatTime(log.timestamp)}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-white/50 capitalize">{log.deviceType.replace('_', ' ')}</span>
          {log.batteryAtEvent !== undefined && (
            <span className="text-xs text-white/50">• Battery: {log.batteryAtEvent}%</span>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SCREENS
// ============================================================================

// Splash Screen
const SplashScreen: React.FC<{ onComplete: () => void; language: AppLanguage }> = ({ onComplete, language }) => {
  const [progress, setProgress] = useState(0);
  const tr = useCallback((text: string) => translateText(language, text), [language]);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setTimeout(onComplete, 300);
          return 100;
        }
        return p + 2;
      });
    }, 30);
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-indigo-950 to-gray-900 flex flex-col items-center justify-center p-8">
      {/* Animated Rings */}
      <div className="relative w-40 h-40 mb-8">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="absolute inset-0 rounded-full border-2 border-indigo-500/30 animate-ping"
            style={{ animationDelay: `${i * 0.3}s`, animationDuration: '2s' }}
          />
        ))}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-indigo-500/50">
            <span className="text-4xl">👁️</span>
          </div>
        </div>
      </div>

      {/* App Name */}
      <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
        Aura Guardian
      </h1>
      <p className="text-indigo-300/70 text-sm mb-8">{tr('Your Vision, Our Mission')}</p>

      {/* Progress Bar */}
      <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-white/40 text-xs mt-3">
        {progress < 30 ? tr('Initializing sensors...') : progress < 60 ? tr('Loading ML models...') : progress < 90 ? tr('Preparing interface...') : tr('Ready!')}
      </p>

      {/* Version */}
      <p className="absolute bottom-8 text-white/30 text-xs">Version 2.0.0 Phase 2</p>
    </div>
  );
};

// Home Screen
const HomeScreen: React.FC<{
  devices: Device[];
  sensorData: SensorData | null;
  isWalking: boolean;
  trips: Trip[];
  activeTrip: Trip | null;
  language: AppLanguage;
  role: AppRole;
  profileName: string;
  currentLocation: UserLocation | null;
  remoteFeedOnline: boolean;
  destination: NavigationSession['destination'];
  geofence: GeofenceState;
  onStartDirections: (destination: { lat: number; lng: number; label: string }) => void;
  onStopDirections: () => void;
  onSetGeofenceCenter: () => void;
  onToggleGeofence: (enabled: boolean) => void;
  onStartWalk: () => void;
  onStopWalk: () => void;
  onSosHoldStart: () => void;
  onSosHoldCancel: () => void;
  onNavigate: (screen: string) => void;
}> = ({
  devices,
  sensorData,
  isWalking,
  trips,
  activeTrip,
  language,
  role,
  profileName,
  currentLocation,
  remoteFeedOnline,
  destination,
  geofence,
  onStartDirections,
  onStopDirections,
  onSetGeofenceCenter,
  onToggleGeofence,
  onStartWalk,
  onStopWalk,
  onSosHoldStart,
  onSosHoldCancel,
  onNavigate,
}) => {
  const connectedDevices = devices.filter(d => d.status === 'connected');
  const allConnected = connectedDevices.length === 3;
  const tr = useCallback((text: string) => translateText(language, text), [language]);
  const roleLabel = role === 'guardian' ? LANGUAGE_LABELS[language].guardian : LANGUAGE_LABELS[language].user;
  const activeTripId = activeTrip?.id;
  const displayTrips = activeTrip ? [activeTrip, ...trips] : trips;
  const recentTrips = displayTrips.slice(0, 2);
  const [destinationInput, setDestinationInput] = useState('');
  const [resolvedDestination, setResolvedDestination] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [destinationSuggestions, setDestinationSuggestions] = useState<DestinationSuggestion[]>([]);
  const [isSearchingDestination, setIsSearchingDestination] = useState(false);
  const [destinationSearchError, setDestinationSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (destination) {
      setDestinationInput(destination.label || `${destination.lat.toFixed(6)}, ${destination.lng.toFixed(6)}`);
      setResolvedDestination({
        lat: destination.lat,
        lng: destination.lng,
        label: destination.label || `${destination.lat.toFixed(6)}, ${destination.lng.toFixed(6)}`,
      });
      return;
    }

    setDestinationInput('');
    setResolvedDestination(null);
  }, [destination]);

  useEffect(() => {
    if (role !== 'guardian') {
      setDestinationSuggestions([]);
      setIsSearchingDestination(false);
      setDestinationSearchError(null);
      return;
    }

    const query = destinationInput.trim();
    const isLatLng = parseLatLngInput(query) !== null;
    if (query.length < 3 || isLatLng) {
      setDestinationSuggestions([]);
      setIsSearchingDestination(false);
      setDestinationSearchError(null);
      return;
    }

    let cancelled = false;
    setIsSearchingDestination(true);
    setDestinationSearchError(null);

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const candidates = await fetchMapplsCandidates(query, '', 5);
          if (!cancelled) {
            setDestinationSuggestions(candidates);
            if (candidates.length === 0) {
              setDestinationSearchError('No places found. Try a different query or latitude,longitude.');
            }
          }
        } catch {
          if (!cancelled) {
            setDestinationSuggestions([]);
            setDestinationSearchError('Place search failed. Try latitude,longitude or a landmark name.');
          }
        } finally {
          if (!cancelled) {
            setIsSearchingDestination(false);
          }
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [destinationInput, role]);

  const startDirectionsFromInput = async () => {
    if (resolvedDestination && destinationInput.trim().length > 0) {
      onStartDirections({
        lat: resolvedDestination.lat,
        lng: resolvedDestination.lng,
        label: resolvedDestination.label || destinationInput.trim(),
      });
      setDestinationSuggestions([]);
      return;
    }

    const parsed = parseLatLngInput(destinationInput);
    if (parsed) {
      onStartDirections({
        ...parsed,
        label: destinationInput,
      });
      return;
    }

    if (destinationInput.trim().length > 2) {
      try {
        const candidates = await fetchMapplsCandidates(destinationInput.trim(), '', 1);
        const candidate = candidates[0];
        if (candidate) {
          onStartDirections({ lat: candidate.lat, lng: candidate.lng, label: candidate.label });
          setDestinationSuggestions([]);
          return;
        }
      } catch {
        // Geocode fallback handled below.
      }
    }

    if (typeof window !== 'undefined') {
      window.alert('Enter destination as latitude,longitude or use a searchable place name.');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-gray-900 via-gray-900 to-transparent pb-4 pt-safe">
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Aura Guardian</h1>
              <p className="text-white/50 text-sm">
                {isWalking ? tr('Walk in progress') : allConnected ? tr('Ready to navigate') : `${connectedDevices.length}/3 ${tr('devices connected')}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {devices.map(d => (
                <div
                  key={d.id}
                  className={`w-3 h-3 rounded-full transition-colors ${
                    d.status === 'connected' ? 'bg-emerald-500' : 
                    d.status === 'connecting' || d.status === 'reconnecting' ? 'bg-amber-500 animate-pulse' : 
                    'bg-gray-500'
                  }`}
                  title={d.name}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4">
        {role === 'guardian' ? (
          <GuardianHomePanel userName={profileName} languageLabel={roleLabel} subtitle={tr('Guardian monitoring mode is active with extended control.')} />
        ) : (
          <UserHomePanel userName={profileName} languageLabel={roleLabel} subtitle={tr('Personal walking assistant mode is active.')} />
        )}

        <div className="bg-white/5 rounded-2xl border border-white/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white font-semibold text-sm">Live Map</h3>
            <span className={`text-xs ${currentLocation ? 'text-emerald-300' : 'text-white/50'}`}>
              {currentLocation ? `${currentLocation.lat.toFixed(5)}, ${currentLocation.lng.toFixed(5)}` : 'Location unavailable'}
            </span>
          </div>
          {!currentLocation && role === 'user' && (
            <button
              onClick={() => {
                if (!navigator.geolocation) return;
                navigator.geolocation.getCurrentPosition(() => {
                  // Permission prompt handled by browser/OS.
                });
              }}
              className="mb-2 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80"
            >
              Enable location permission
            </button>
          )}
          <LeafletMapPanel
            currentLocation={currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : null}
          />

          {role === 'guardian' ? (
            <div className="mt-3 space-y-2">
              <div className="text-xs text-white/60">
                {remoteFeedOnline ? 'Remote user is live. Start launches in-app walking navigation on the user phone.' : 'Waiting for user live feed.'}
              </div>
              <div className="flex gap-2">
                <input
                  value={destinationInput}
                  onChange={(event) => {
                    setDestinationInput(event.target.value);
                    setResolvedDestination(null);
                  }}
                  placeholder="Search place or lat,lng"
                  className="flex-1 rounded-lg bg-gray-900/80 border border-white/10 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                />
                <button
                  onClick={() => { void startDirectionsFromInput(); }}
                  className="rounded-lg bg-cyan-500/20 text-cyan-300 px-3 py-2 text-xs font-medium"
                >
                  Start
                </button>
                <button
                  onClick={onStopDirections}
                  className="rounded-lg bg-red-500/20 text-red-300 px-3 py-2 text-xs font-medium"
                >
                  Stop
                </button>
              </div>
              {(isSearchingDestination || destinationSuggestions.length > 0) && (
                <div className="rounded-lg border border-white/10 bg-gray-900/85 max-h-36 overflow-y-auto">
                  {isSearchingDestination && (
                    <div className="px-3 py-2 text-xs text-white/60">Searching places...</div>
                  )}
                  {!isSearchingDestination && destinationSuggestions.map((item, index) => (
                    <button
                      key={`${item.lat}-${item.lng}-${index}`}
                      onClick={() => {
                        setDestinationInput(item.label);
                        setResolvedDestination({ lat: item.lat, lng: item.lng, label: item.label });
                        setDestinationSuggestions([]);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-white/85 hover:bg-white/10"
                    >
                      <div className="font-medium truncate">{item.label}</div>
                      <div className="text-white/50 font-mono">{item.lat.toFixed(5)}, {item.lng.toFixed(5)}</div>
                    </button>
                  ))}
                </div>
              )}
              {destinationSearchError && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  {destinationSearchError}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/60">Geofence</span>
                <button
                  onClick={() => onToggleGeofence(!geofence.enabled)}
                  className={`w-11 h-6 rounded-full transition-colors ${geofence.enabled ? 'bg-emerald-500' : 'bg-white/20'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${geofence.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-white/70">
                <span>Radius: {Math.round(geofence.radiusM)} m</span>
                <span className={geofence.inside ? 'text-emerald-300' : 'text-red-300'}>
                  {geofence.enabled ? (geofence.inside ? 'Inside zone' : 'Outside zone') : 'Disabled'}
                </span>
              </div>
              <button
                onClick={onSetGeofenceCenter}
                className="w-full rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80"
              >
                Set current location as geofence center
              </button>
              {destination && (
                <div className="text-xs text-cyan-300">
                  Active directions: {destination.label}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Active Walk Radar */}
        {isWalking && sensorData && (
          <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 backdrop-blur-xl rounded-3xl border border-indigo-500/20 p-4 animate-fadeIn">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-400 text-sm font-medium">{tr('Live Navigation')}</span>
              </div>
              <button
                onClick={onStopWalk}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium"
              >
                {tr('End Walk')}
              </button>
            </div>
            
            <RadarView sensorData={sensorData} />

            {/* IMU Badges */}
            <div className="flex justify-center gap-2 mt-4">
              {sensorData.imuFlags.stairsDetected && (
                <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium">
                  🪜 {tr('Stairs Detected')}
                </span>
              )}
              {sensorData.imuFlags.roughSurface && (
                <span className="px-3 py-1 rounded-full bg-orange-500/20 text-orange-400 text-xs font-medium">
                  ⚠️ {tr('Rough Surface')}
                </span>
              )}
              {sensorData.imuFlags.fallDetected && (
                <span className="px-3 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-medium animate-pulse">
                  🚨 {tr('Fall Detected!')}
                </span>
              )}
              <span className="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-medium">
                👣 {sensorData.imuFlags.stepCount} {tr('Steps').toLowerCase()}
              </span>
            </div>
          </div>
        )}

        {/* Start Walk Button */}
        {!isWalking && (
          <button
            onClick={allConnected ? onStartWalk : () => onNavigate('devices')}
            className={`w-full py-5 rounded-2xl font-bold text-lg transition-all duration-300 ${
              allConnected
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-xl shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:scale-[1.02] active:scale-[0.98]'
                : 'bg-white/10 text-white/70'
            }`}
          >
            <div className="flex items-center justify-center gap-3">
              <div className="w-6 h-6"><Icons.Walking /></div>
              {allConnected ? tr('Start Walk') : tr('Connect Devices First')}
            </div>
          </button>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onNavigate('sensors')}
            className="bg-white/5 backdrop-blur-xl rounded-2xl p-4 border border-white/10 hover:border-indigo-500/30 transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Icons.Eye />
            </div>
            <span className="text-white font-medium">{tr('Live Sensors')}</span>
            <p className="text-white/40 text-xs mt-1">{tr('View real-time data')}</p>
          </button>

          <button
            onClick={() => onNavigate('devices')}
            className="bg-white/5 backdrop-blur-xl rounded-2xl p-4 border border-white/10 hover:border-indigo-500/30 transition-all group"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <Icons.Devices />
            </div>
            <span className="text-white font-medium">{LANGUAGE_LABELS[language].devices}</span>
            <p className="text-white/40 text-xs mt-1">{tr('Manage connections')}</p>
          </button>
        </div>

        {/* Device Status Cards */}
        <div className="space-y-3">
          <h2 className="text-white/70 font-medium text-sm px-1">{tr('Device Status')}</h2>
          {devices.map(device => (
            <div
              key={device.id}
              onClick={() => onNavigate('devices')}
              className={`bg-white/5 backdrop-blur-xl rounded-2xl p-4 border transition-all cursor-pointer ${
                device.status === 'connected' ? 'border-emerald-500/20' : 'border-white/10'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl ${
                  device.status === 'connected' ? 'bg-emerald-500/20' : 'bg-white/5'
                }`}>
                  {device.type === 'chest' ? '📡' : '⌚'}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{device.name}</span>
                    {device.status === 'connected' && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
                        {tr('Connected')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-white/50 text-sm">
                    <span className="flex items-center gap-1">
                      <div className="w-4 h-4"><Icons.Battery level={device.battery} /></div>
                      {Math.round(device.battery)}%
                    </span>
                    {device.status === 'connected' && (
                      <span className="flex items-center gap-1" style={{ color: device.healthScore >= 70 ? '#10b981' : '#f59e0b' }}>
                        <div className="w-4 h-4"><Icons.Heart /></div>
                        {device.healthScore}% health
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-5 h-5 text-white/30"><Icons.ChevronRight /></div>
              </div>
            </div>
          ))}
        </div>

        {/* Recent Trips */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-white/70 font-medium text-sm">{tr('Recent Trips')}</h2>
            <button className="text-indigo-400 text-sm">{tr('View All')}</button>
          </div>
          {recentTrips.length === 0 ? (
            <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-4 border border-white/10 text-white/50 text-sm">
              {tr('No trips yet. Start a walk to build history.')}
            </div>
          ) : recentTrips.map(trip => {
            const isLive = activeTripId === trip.id;
            return (
              <div key={trip.id} className="bg-white/5 backdrop-blur-xl rounded-2xl p-4 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-medium">{trip.routeName}</span>
                  {isLive ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-cyan-500/20 text-cyan-300">LIVE</span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      trip.safetyScore >= 90 ? 'bg-emerald-500/20 text-emerald-400' :
                      trip.safetyScore >= 70 ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {trip.safetyScore}% safe
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-white/50 text-sm">
                  <span>{trip.distance} km</span>
                  <span>{trip.duration} min</span>
                  <span>{trip.obstaclesDetected} obstacles</span>
                </div>
                <div className="text-white/30 text-xs mt-2">
                  {trip.date} • {trip.startTime} - {isLive ? 'Now' : trip.endTime}
                </div>
              </div>
            );
          })}
        </div>

        {/* SOS Button */}
        <button
          onPointerDown={onSosHoldStart}
          onPointerUp={onSosHoldCancel}
          onPointerLeave={onSosHoldCancel}
          onPointerCancel={onSosHoldCancel}
          onTouchStart={onSosHoldStart}
          onTouchEnd={onSosHoldCancel}
          className="w-full py-4 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-400 font-bold flex items-center justify-center gap-2 hover:bg-red-500/30 transition-all"
          aria-label="Emergency SOS. Press and hold for 5 seconds"
        >
          <div className="w-6 h-6"><Icons.Phone /></div>
          {tr('SOS Emergency')}
        </button>
      </div>
    </div>
  );
};

// Device Manager Screen (Phase 2 Enhanced)
const DeviceManagerScreen: React.FC<{
  devices: Device[];
  deviceLogs: DeviceLog[];
  isScanning: boolean;
  language: AppLanguage;
  connectionMode: ConnectionMode;
  wifiHostOverride: string;
  onWifiHostOverrideChange: (value: string) => void;
  onConnectionModeChange: (mode: ConnectionMode) => void;
  onStartScan: () => void;
  onConnect: (deviceId: string) => void;
  onDisconnect: (deviceId: string) => void;
  onConnectAll: () => void;
  onNavigate: (screen: string) => void;
}> = ({ devices, deviceLogs, isScanning, language, connectionMode, wifiHostOverride, onWifiHostOverrideChange, onConnectionModeChange, onStartScan, onConnect, onDisconnect, onConnectAll, onNavigate: _onNavigate }) => {
  void _onNavigate;
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const tr = useCallback((text: string) => translateText(language, text), [language]);
  const connectedCount = devices.filter(d => d.status === 'connected').length;
  const connectLabel = connectionMode === 'wired' ? 'Connect USB' : 'Connect Wi-Fi';
  const transportLabel = connectionMode === 'wired' ? 'USB Serial' : 'Wi-Fi (HTTP Poll)';

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-gray-900 via-gray-900 to-transparent pb-4 pt-safe">
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">{LANGUAGE_LABELS[language].devices}</h1>
              <p className="text-white/50 text-sm">{connectedCount}/3 connected via {transportLabel}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className={`p-2.5 rounded-xl transition-colors ${
                  showLogs ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white/10 text-white/70'
                }`}
              >
                <div className="w-5 h-5"><Icons.Logs /></div>
              </button>
              <button
                onClick={onStartScan}
                disabled={isScanning}
                className={`p-2.5 rounded-xl bg-white/10 text-white/70 transition-colors ${
                  isScanning ? 'animate-spin' : 'hover:bg-white/20'
                }`}
              >
                <div className="w-5 h-5"><Icons.Refresh /></div>
              </button>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="connection-mode" className="block text-xs font-medium text-white/60 mb-2">
              {tr('Connection Method')}
            </label>
            <select
              id="connection-mode"
              value={connectionMode}
              onChange={(event) => onConnectionModeChange(event.target.value as ConnectionMode)}
              className="w-full rounded-xl bg-white/10 border border-white/15 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-400"
            >
              <option value="wired" className="bg-gray-900">{tr('Wired (USB Serial)')}</option>
              <option value="wifi" className="bg-gray-900">{tr('Wireless (Wi-Fi)')}</option>
            </select>
            <p className="text-xs text-white/40 mt-2">
              {connectionMode === 'wired'
                ? tr('Use browser Web Serial and select the chest COM port.')
                : tr('Uses ESP32 Wi-Fi stream over your 2.4GHz hotspot. No API auth required.')}
            </p>

            {connectionMode === 'wifi' && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                <label htmlFor="wifi-host-override" className="block text-xs font-medium text-white/60">
                  {tr('Backup Host/IP Override')}
                </label>
                <div className="flex gap-2">
                  <input
                    id="wifi-host-override"
                    value={wifiHostOverride}
                    onChange={(event) => onWifiHostOverrideChange(event.target.value)}
                    placeholder="esp32.local or 192.168.4.1"
                    className="flex-1 rounded-lg bg-gray-900/80 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
                  />
                  <button
                    onClick={() => onWifiHostOverrideChange('')}
                    className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-xs text-white/40">
                  {tr('Used first when mDNS does not resolve.')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-emerald-500/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-emerald-400">{connectedCount}</div>
            <div className="text-xs text-white/50">{tr('Connected')}</div>
          </div>
          <div className="bg-amber-500/10 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-amber-400">
              {devices.filter(d => d.status === 'connecting' || d.status === 'reconnecting').length}
            </div>
            <div className="text-xs text-white/50">{tr('Connecting')}</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-white/70">
              {Math.round(devices.reduce((acc, d) => acc + d.healthScore, 0) / devices.length)}%
            </div>
            <div className="text-xs text-white/50">{tr('Avg Health')}</div>
          </div>
        </div>

        {/* Connect Chest USB */}
        {connectedCount < 3 && (
          <button
            onClick={onConnectAll}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/30"
          >
            <div className="w-5 h-5"><Icons.Wifi /></div>
            {connectionMode === 'wired' ? 'Connect Chest USB' : 'Connect Chest Wi-Fi'}
          </button>
        )}

        {/* Device List */}
        <div className="space-y-3">
          <h2 className="text-white/70 font-medium text-sm px-1">{tr('Aura Guardian Devices')}</h2>
          {devices.map(device => (
            <DeviceHealthCard
              key={device.id}
              device={device}
              onConnect={() => onConnect(device.id)}
              onDisconnect={() => onDisconnect(device.id)}
              connectLabel={connectLabel}
              isExpanded={expandedDevice === device.id}
              onToggleExpand={() => setExpandedDevice(expandedDevice === device.id ? null : device.id)}
            />
          ))}
        </div>

        {/* Device Logs */}
        {showLogs && (
          <div className="space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-white/70 font-medium text-sm">{tr('Device Logs')}</h2>
              <span className="text-white/40 text-xs">{deviceLogs.length} events</span>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {deviceLogs.slice(0, 20).map(log => (
                <DeviceLogItem key={log.id} log={log} />
              ))}
              {deviceLogs.length === 0 && (
                <div className="text-center text-white/40 py-8">{tr('No device events yet')}</div>
              )}
            </div>
          </div>
        )}

        {/* Serial Transport Info */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
          <h3 className="text-white font-medium mb-2">{tr('Transport Details')}</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-white/50">{tr('Connection')}</span>
              <span className="text-white/70">{transportLabel}</span>
            </div>
            {connectionMode === 'wired' ? (
              <div className="flex justify-between">
                <span className="text-white/50">Baud Rate</span>
                <span className="text-white/70 font-mono text-xs">{WEB_SERIAL_BAUD_RATE}</span>
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-white/50">Hotspot SSID</span>
                  <span className="text-white/70">{WIFI_SSID}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Hotspot Password</span>
                  <span className="text-white/70">{WIFI_PASSWORD}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Telemetry Path</span>
                  <span className="text-white/70 font-mono text-xs">{WIFI_SENSOR_POLL_PATH}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Primary ESP Host</span>
                  <span className="text-white/70">{WIFI_HOST_CANDIDATES[0]}</span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-white/50">{tr('Source Format')}</span>
              <span className="text-white/70">Distances + TOF/IMU/DHT live diagnostics</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">{tr('Wrists Status')}</span>
              <span className="text-emerald-400">Auto from "Wrists:" line</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Sensor Live View Screen (Phase 2 Enhanced)
const SensorLiveViewScreen: React.FC<{
  sensorData: SensorData | null;
  language: AppLanguage;
  feedConnected: boolean;
  feedSourceLabel?: string;
  sensorHistory: {
    left: number[];
    center: number[];
    right: number[];
    ground: number[];
    far: number[];
    accelMag: number[];
    temperature: number[];
    humidity: number[];
    stepCount: number[];
    tofValid: number[];
  };
  devices: Device[];
  isPaused: boolean;
  onTogglePause: () => void;
  onNavigate: (screen: string) => void;
}> = ({ sensorData, language, feedConnected, feedSourceLabel, sensorHistory, devices, isPaused, onTogglePause, onNavigate }) => {
  const chestDevice = devices.find(d => d.type === 'chest');
  const isConnected = feedConnected || chestDevice?.status === 'connected';
  const [viewMode, setViewMode] = useState<'radar' | 'graphs' | 'raw'>('radar');
  const tr = useCallback((text: string) => translateText(language, text), [language]);

  const sensorConfigs = [
    { key: 'left', label: 'Left', color: '#8b5cf6', icon: '←' },
    { key: 'center', label: 'Center ToF', color: '#06b6d4', icon: '↑' },
    { key: 'right', label: 'Right', color: '#f59e0b', icon: '→' },
    { key: 'ground', label: 'Front US', color: '#10b981', icon: '⇡' },
    { key: 'far', label: 'ToF Raw', color: '#ec4899', icon: '⬆' },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-gray-900 via-gray-900 to-transparent pb-4 pt-safe">
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">{tr('Live Sensors')}</h1>
              <p className="text-white/50 text-sm">
                {isConnected ? (isPaused ? tr('Paused') : (feedSourceLabel || tr('Streaming @ 10Hz'))) : tr('Chest device disconnected')}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onTogglePause}
                disabled={!isConnected}
                className={`p-2.5 rounded-xl transition-colors ${
                  isPaused ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                } ${!isConnected ? 'opacity-50' : ''}`}
              >
                <div className="w-5 h-5">
                  {isPaused ? <Icons.Play /> : <Icons.Pause />}
                </div>
              </button>
            </div>
          </div>

          {/* View Mode Tabs */}
          <div className="flex gap-2 mt-4">
            {[
              { id: 'radar', label: tr('Radar'), icon: <Icons.Sensors /> },
              { id: 'graphs', label: tr('Graphs'), icon: <Icons.Activity /> },
              { id: 'raw', label: tr('Raw'), icon: <Icons.Cpu /> },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id as 'radar' | 'graphs' | 'raw')}
                className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-all ${
                  viewMode === tab.id
                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                    : 'bg-white/5 text-white/50 border border-transparent'
                }`}
              >
                <div className="w-4 h-4">{tab.icon}</div>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 space-y-4">
        {!isConnected ? (
          <div className="bg-white/5 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-4">
              <Icons.AlertTriangle />
            </div>
            <h3 className="text-white font-semibold mb-2">{tr('Chest Device Disconnected')}</h3>
            <p className="text-white/50 text-sm mb-4">{tr('Connect the chest device to view live sensor data')}</p>
            <button
              onClick={() => onNavigate('devices')}
              className="px-6 py-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 font-medium"
            >
              {tr('Go to Devices')}
            </button>
          </div>
        ) : viewMode === 'radar' ? (
          <>
            {/* Radar View */}
            <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-4 border border-white/10">
              <RadarView sensorData={sensorData} />
            </div>

            {/* Distance Bars */}
            <div className="space-y-3">
              {sensorConfigs.map(sensor => {
                const value = sensorData?.[sensor.key as keyof SensorData] as number ?? 0;
                const zone = getDistanceZone(value);
                const percentage = Math.min(100, (value / 400) * 100);

                return (
                  <div key={sensor.key} className="bg-white/5 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{sensor.icon}</span>
                        <span className="text-white font-medium">{sensor.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-mono">{formatDistance(value)}</span>
                        <span
                          className="px-2 py-0.5 rounded text-xs font-medium"
                          style={{ backgroundColor: zone.color + '33', color: zone.color }}
                        >
                          {zone.label}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-150"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: zone.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* IMU Status */}
            {sensorData && (
              <div className="bg-white/5 rounded-2xl p-4">
                <h3 className="text-white font-medium mb-3">{tr('IMU Status')}</h3>
                <div className="grid grid-cols-1 gap-3 mb-3">
                  <div className={`p-3 rounded-xl border ${sensorData.imu.live ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                    <div className="text-xs text-white/60 mb-1">{tr('IMU Live Health')}</div>
                    <div className={`font-semibold ${sensorData.imu.live ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sensorData.imu.live ? 'LIVE' : 'STALE / NOT UPDATING'}
                    </div>
                    <div className="text-xs text-white/60 mt-1 font-mono">
                      ax {sensorData.imu.accelX.toFixed(2)} | ay {sensorData.imu.accelY.toFixed(2)} | az {sensorData.imu.accelZ.toFixed(2)} | |a| {sensorData.imu.accelMag.toFixed(2)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className={`p-3 rounded-xl border ${sensorData.tof.valid ? 'bg-pink-500/10 border-pink-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                      <div className="text-xs text-white/60 mb-1">{tr('ToF Status')}</div>
                      <div className={`font-semibold ${sensorData.tof.valid ? 'text-pink-400' : 'text-red-400'}`}>
                        {sensorData.tof.valid ? 'VALID' : 'INVALID / FALLBACK'}
                      </div>
                      <div className="text-xs text-white/60 mt-1 font-mono">
                        raw {sensorData.tof.rawMm ?? 0} mm | fallback {sensorData.tof.usingFallback ? 'yes' : 'no'}
                      </div>
                    </div>
                    <div className={`p-3 rounded-xl border ${sensorData.environment.dhtLive ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                      <div className="text-xs text-white/60 mb-1">{tr('DHT11 Status')}</div>
                      <div className={`font-semibold ${sensorData.environment.dhtLive ? 'text-cyan-400' : 'text-red-400'}`}>
                        {sensorData.environment.dhtLive ? 'LIVE' : 'STALE / READ FAIL'}
                      </div>
                      <div className="text-xs text-white/60 mt-1 font-mono">
                        T {Number.isFinite(sensorData.environment.temperature) ? sensorData.environment.temperature?.toFixed(1) : '--'} C | H {Number.isFinite(sensorData.environment.humidity) ? sensorData.environment.humidity?.toFixed(1) : '--'}%
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className={`p-3 rounded-xl ${sensorData.imuFlags.stairsDetected ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-white/5'}`}>
                    <div className="text-lg mb-1">🪜</div>
                    <div className={`text-sm font-medium ${sensorData.imuFlags.stairsDetected ? 'text-amber-400' : 'text-white/50'}`}>
                      {sensorData.imuFlags.stairsDetected ? tr('Stairs Detected') : tr('No Stairs')}
                    </div>
                  </div>
                  <div className={`p-3 rounded-xl ${sensorData.imuFlags.roughSurface ? 'bg-orange-500/20 border border-orange-500/30' : 'bg-white/5'}`}>
                    <div className="text-lg mb-1">⚠️</div>
                    <div className={`text-sm font-medium ${sensorData.imuFlags.roughSurface ? 'text-orange-400' : 'text-white/50'}`}>
                      {sensorData.imuFlags.roughSurface ? tr('Rough Surface') : tr('Smooth Surface')}
                    </div>
                  </div>
                  <div className={`p-3 rounded-xl ${sensorData.imuFlags.fallDetected ? 'bg-red-500/20 border border-red-500/30 animate-pulse' : 'bg-white/5'}`}>
                    <div className="text-lg mb-1">🚨</div>
                    <div className={`text-sm font-medium ${sensorData.imuFlags.fallDetected ? 'text-red-400' : 'text-white/50'}`}>
                      {sensorData.imuFlags.fallDetected ? tr('Fall Detected!') : tr('No Fall')}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                    <div className="text-lg mb-1">👣</div>
                    <div className="text-sm font-medium text-indigo-400">
                      {sensorData.imuFlags.stepCount} Steps
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : viewMode === 'graphs' ? (
          <>
            {/* Multi-Line Chart */}
            <MultiLineChart data={sensorHistory} height={250} />

            {/* Individual Sensor Charts */}
            <div className="grid grid-cols-1 gap-4">
              {sensorConfigs.map(sensor => (
                <div key={sensor.key} className="bg-white/5 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: sensor.color }} />
                    <span className="text-white/70 text-sm font-medium">{sensor.label} Sensor</span>
                  </div>
                  <LineChart
                    data={sensorHistory[sensor.key as keyof typeof sensorHistory] || []}
                    color={sensor.color}
                    height={100}
                    maxValue={400}
                    label={`${sensor.label} (30s)`}
                    valueSuffix="cm"
                  />
                </div>
              ))}
            </div>

            {/* Advanced Telemetry Graphs */}
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-white/5 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#f97316' }} />
                  <span className="text-white/70 text-sm font-medium">Acceleration Magnitude</span>
                </div>
                <LineChart
                  data={sensorHistory.accelMag}
                  color="#f97316"
                  height={100}
                  minValue={0}
                  maxValue={30}
                  label="|a| (m/s2)"
                  valueSuffix="m/s2"
                />
              </div>

              <div className="bg-white/5 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#22d3ee' }} />
                  <span className="text-white/70 text-sm font-medium">Temperature & Humidity</span>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <LineChart
                    data={sensorHistory.temperature}
                    color="#22d3ee"
                    height={90}
                    minValue={0}
                    maxValue={60}
                    label="Temperature"
                    valueSuffix="C"
                  />
                  <LineChart
                    data={sensorHistory.humidity}
                    color="#34d399"
                    height={90}
                    minValue={0}
                    maxValue={100}
                    label="Humidity"
                    valueSuffix="%"
                  />
                </div>
              </div>

              <div className="bg-white/5 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#a78bfa' }} />
                  <span className="text-white/70 text-sm font-medium">Steps & ToF Validity</span>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <LineChart
                    data={sensorHistory.stepCount}
                    color="#a78bfa"
                    height={90}
                    minValue={0}
                    maxValue={Math.max(50, ...(sensorHistory.stepCount.length > 0 ? sensorHistory.stepCount : [0]))}
                    label="Step Count"
                    valueSuffix="steps"
                  />
                  <LineChart
                    data={sensorHistory.tofValid}
                    color="#f43f5e"
                    height={90}
                    minValue={0}
                    maxValue={1}
                    label="ToF Valid (0/1)"
                    valueSuffix=""
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Raw Packet View */}
            <div className="bg-gray-900 rounded-2xl p-4 font-mono text-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="text-emerald-400">RAW WIFI FRAME</span>
                <span className="text-white/50">{sensorData ? formatTime(sensorData.timestamp) : '--:--:--'}</span>
              </div>

              {sensorData ? (
                <>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {sensorData.rawPacket.map((byte, i) => (
                      <div key={i} className="flex flex-col items-center">
                        <span className="text-white/40 text-xs mb-1">[{i}]</span>
                        <span className={`px-2 py-1 rounded ${
                          i === 0 ? 'bg-purple-500/30 text-purple-300' :
                          i <= 5 ? 'bg-cyan-500/30 text-cyan-300' :
                          i === 6 ? 'bg-emerald-500/30 text-emerald-300' :
                          i === 7 ? 'bg-amber-500/30 text-amber-300' :
                          'bg-white/10 text-white/50'
                        }`}>
                          0x{byte.toString(16).toUpperCase().padStart(2, '0')}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2 text-xs border-t border-white/10 pt-4">
                    <div className="flex justify-between">
                      <span className="text-purple-300">[0] Header</span>
                      <span className="text-white">0xAA (valid)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cyan-300">[1] Left</span>
                      <span className="text-white">{sensorData.left} cm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cyan-300">[2] Center</span>
                      <span className="text-white">{sensorData.center} cm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cyan-300">[3] Right</span>
                      <span className="text-white">{sensorData.right} cm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cyan-300">[4] Front US</span>
                      <span className="text-white">{sensorData.ground} cm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-cyan-300">[5] ToF Raw</span>
                      <span className="text-white">{sensorData.far} cm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-emerald-300">[6] Battery</span>
                      <span className="text-white">{Math.round(sensorData.battery)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-300">[7] IMU Flags</span>
                      <span className="text-white">
                        0b{sensorData.rawPacket[7].toString(2).padStart(8, '0')}
                      </span>
                    </div>
                    <div className="pl-4 space-y-1 text-white/60">
                      <div>bit0 fall: {sensorData.imuFlags.fallDetected ? '1' : '0'}</div>
                      <div>bit1 stairs: {sensorData.imuFlags.stairsDetected ? '1' : '0'}</div>
                      <div>bit2 rough: {sensorData.imuFlags.roughSurface ? '1' : '0'}</div>
                      <div>bit3-7 steps: {sensorData.imuFlags.stepCount}</div>
                    </div>
                    <div className="pt-3 mt-3 border-t border-white/10 text-white/60 space-y-1">
                      <div>tof valid: {sensorData.tof.valid ? 'true' : 'false'}</div>
                      <div>tof raw(mm): {sensorData.tof.rawMm ?? 0}</div>
                      <div>tof fallback: {sensorData.tof.usingFallback ? 'true' : 'false'}</div>
                      <div>imu live: {sensorData.imu.live ? 'true' : 'false'}</div>
                      <div>accel mag: {sensorData.imu.accelMag.toFixed(2)}</div>
                      <div>dht live: {sensorData.environment.dhtLive ? 'true' : 'false'}</div>
                      <div>temp: {Number.isFinite(sensorData.environment.temperature) ? sensorData.environment.temperature?.toFixed(1) : '--'} C</div>
                      <div>humidity: {Number.isFinite(sensorData.environment.humidity) ? sensorData.environment.humidity?.toFixed(1) : '--'}%</div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-white/40 text-center py-8">Waiting for data...</div>
              )}
            </div>

            {/* Packet Stats */}
            {chestDevice && (
              <div className="bg-white/5 rounded-2xl p-4">
                <h3 className="text-white font-medium mb-3">Connection Stats</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-white/50 text-xs mb-1">Packet Loss</div>
                    <div className="text-xl font-bold text-white">{chestDevice.packetLoss.toFixed(1)}%</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-white/50 text-xs mb-1">Latency</div>
                    <div className="text-xl font-bold text-white">{chestDevice.latency}ms</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-white/50 text-xs mb-1">RSSI</div>
                    <div className="text-xl font-bold text-white">{chestDevice.rssi} dBm</div>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <div className="text-white/50 text-xs mb-1">Health Score</div>
                    <div className="text-xl font-bold" style={{
                      color: chestDevice.healthScore >= 70 ? '#10b981' : chestDevice.healthScore >= 40 ? '#f59e0b' : '#ef4444'
                    }}>{chestDevice.healthScore}%</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// Settings Screen
const SettingsScreen: React.FC<{
  onNavigate: (screen: string) => void;
  language: AppLanguage;
  profileName: string;
  profileEmail: string;
  userUid: string;
  role: AppRole;
  relayEnabled: boolean;
  hapticEnabled: boolean;
  hapticIntensity: number;
  fallDetectionEnabled: boolean;
  sosAutoCallEnabled: boolean;
  emergencyContacts: EmergencyContact[];
  autoLaunchNavigation: boolean;
  monitorUserUid: string;
  remoteFeedOnline: boolean;
  remoteFeedUserUid: string;
  onSignOut: () => void;
  onRelayEnabledChange: (enabled: boolean) => void;
  onHapticEnabledChange: (enabled: boolean) => void;
  onHapticIntensityChange: (value: number) => void;
  onFallDetectionEnabledChange: (enabled: boolean) => void;
  onSosAutoCallEnabledChange: (enabled: boolean) => void;
  onEmergencyContactsChange: (contacts: EmergencyContact[]) => void;
  onAutoLaunchNavigationChange: (enabled: boolean) => void;
  onMonitorUserUidChange: (uid: string) => void;
  onLanguageChange: (language: AppLanguage) => void;
}> = ({
  onNavigate: _onNavigate,
  language,
  profileName,
  profileEmail,
  userUid,
  role,
  relayEnabled,
  hapticEnabled,
  hapticIntensity,
  fallDetectionEnabled,
  sosAutoCallEnabled,
  emergencyContacts,
  autoLaunchNavigation,
  monitorUserUid,
  remoteFeedOnline,
  remoteFeedUserUid,
  onSignOut,
  onRelayEnabledChange,
  onHapticEnabledChange,
  onHapticIntensityChange,
  onFallDetectionEnabledChange,
  onSosAutoCallEnabledChange,
  onEmergencyContactsChange,
  onAutoLaunchNavigationChange,
  onMonitorUserUidChange,
  onLanguageChange,
}) => {
  void _onNavigate;
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [monitorInput, setMonitorInput] = useState(monitorUserUid);
  const tr = useCallback((text: string) => translateText(language, text), [language]);
  const roleLabel = role === 'guardian' ? LANGUAGE_LABELS[language].guardian : LANGUAGE_LABELS[language].user;

  useEffect(() => {
    setMonitorInput(monitorUserUid);
  }, [monitorUserUid]);

  const settingsSections = [
    {
      title: 'General',
      items: [
        { id: 'language', label: 'Language', value: language, type: 'select', options: ['English', 'Hindi', 'Tamil', 'Telugu'] },
        { id: 'units', label: 'Distance Units', value: 'Metric', type: 'select', options: ['Metric', 'Imperial'] },
      ],
    },
    {
      title: 'Accessibility',
      items: [
        { id: 'haptic-feedback', label: 'Haptic Feedback', value: hapticEnabled, type: 'toggle' },
        { id: 'voice-guidance', label: 'Voice Guidance', value: voiceEnabled, type: 'toggle' },
        { id: 'haptic-intensity', label: 'Haptic Intensity', value: hapticIntensity, type: 'slider' },
        { id: 'voice-speed', label: 'Voice Speed', value: 1.0, type: 'slider' },
      ],
    },
    {
      title: 'Navigation',
      items: [
        { id: 'auto-launch-nav', label: 'Auto Launch Directions', value: autoLaunchNavigation, type: 'toggle' },
      ],
    },
    {
      title: 'Safety',
      items: [
        { id: 'fall-detection', label: 'Fall Detection', value: fallDetectionEnabled, type: 'toggle' },
        { id: 'emergency-contacts', label: 'Emergency Contacts', value: `${emergencyContacts.length} contacts`, type: 'link' },
        { id: 'sos-autocall', label: 'SOS Auto-call', value: sosAutoCallEnabled, type: 'toggle' },
      ],
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-gray-900 via-gray-900 to-transparent pb-4 pt-safe">
        <div className="px-4 pt-4">
          <h1 className="text-2xl font-bold text-white">{LANGUAGE_LABELS[language].settingsTitle}</h1>
          <p className="text-white/50 text-sm">{LANGUAGE_LABELS[language].settingsSubtitle}</p>
        </div>
      </div>

      <div className="px-4 space-y-6">
        {/* User Profile */}
        <div className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-2xl p-4 border border-indigo-500/20">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl">
              👤
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold text-lg">{profileName}</h3>
              <p className="text-white/50 text-sm">{profileEmail || roleLabel}</p>
              <p className="text-white/40 text-xs mt-1">{roleLabel}</p>
            </div>
            <div className="w-5 h-5 text-white/30"><Icons.ChevronRight /></div>
          </div>
        </div>

        {role === 'user' ? (
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-cyan-300 font-semibold text-sm">Guardian Live Relay</h3>
              <button
                onClick={() => onRelayEnabledChange(!relayEnabled)}
                className={`w-12 h-7 rounded-full transition-colors ${relayEnabled ? 'bg-emerald-500' : 'bg-white/20'}`}
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${relayEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <p className="text-white/60 text-sm">
              When enabled, your live status, location, and safety events are auto-shared to linked guardian accounts.
            </p>
            <div className="bg-black/25 rounded-xl px-3 py-2">
              <div className="text-xs text-white/50 mb-1">Share ID (give this to guardian)</div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-white font-mono text-xs break-all">{userUid || '---'}</span>
                <button
                  onClick={() => {
                    if (!userUid || typeof navigator === 'undefined') return;
                    void navigator.clipboard.writeText(userUid);
                  }}
                  className="px-2 py-1 rounded-lg bg-white/10 text-white/80 text-xs"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-3">
            <h3 className="text-amber-300 font-semibold text-sm">Guardian Remote Feed</h3>
            <p className="text-white/60 text-sm">
              Paste the User Share ID. You will receive live feed automatically when the user is connected.
            </p>
            <input
              value={monitorInput}
              onChange={(event) => setMonitorInput(event.target.value)}
              placeholder="Enter user share ID"
              className="w-full rounded-xl bg-gray-900/70 border border-white/15 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
            />
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => onMonitorUserUidChange(monitorInput)}
                className="px-4 py-2 rounded-xl bg-amber-500/20 text-amber-300 text-sm font-medium"
              >
                Save Share ID
              </button>
              <span className={`text-xs font-medium ${remoteFeedOnline ? 'text-emerald-300' : 'text-white/50'}`}>
                {remoteFeedOnline ? `Live from ${remoteFeedUserUid || monitorUserUid}` : 'Waiting for user feed'}
              </span>
            </div>
          </div>
        )}

        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-2xl p-4 space-y-2">
          <h3 className="text-cyan-300 font-semibold text-sm">OpenStreetMap</h3>
          <p className="text-white/60 text-sm">
            The app now uses an online OpenStreetMap view, so no map key is required.
          </p>
        </div>

        {/* Settings Sections */}
        {settingsSections.map(section => (
          <div key={section.title} className="space-y-2">
            <h2 className="text-white/70 font-medium text-sm px-1">{tr(section.title)}</h2>
            <div className="bg-white/5 rounded-2xl divide-y divide-white/5">
              {section.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4">
                  <span className="text-white">{tr(item.label)}</span>
                  {item.type === 'toggle' ? (
                    <button
                      onClick={() => {
                        if (item.id === 'haptic-feedback') onHapticEnabledChange(!hapticEnabled);
                        if (item.id === 'voice-guidance') setVoiceEnabled(!voiceEnabled);
                        if (item.id === 'fall-detection') onFallDetectionEnabledChange(!fallDetectionEnabled);
                        if (item.id === 'sos-autocall') onSosAutoCallEnabledChange(!sosAutoCallEnabled);
                        if (item.id === 'auto-launch-nav') onAutoLaunchNavigationChange(!autoLaunchNavigation);
                      }}
                      className={`w-12 h-7 rounded-full transition-colors ${
                        item.value ? 'bg-indigo-500' : 'bg-white/20'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                        item.value ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  ) : item.type === 'select' ? (
                    <select
                      value={item.value as string}
                      onChange={(e) => {
                        if (item.id === 'language') onLanguageChange(toLanguage(e.target.value));
                      }}
                      className="bg-white/10 text-white/70 rounded-lg px-3 py-1.5 text-sm border-none outline-none"
                    >
                      {('options' in item && item.options) ? item.options.map((opt: string) => (
                        <option key={opt} value={opt} className="bg-gray-800">{tr(opt)}</option>
                      )) : null}
                    </select>
                  ) : item.type === 'slider' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={item.id === 'haptic-intensity' ? 0 : 0}
                        max={item.id === 'haptic-intensity' ? 20 : 100}
                        step={item.id === 'haptic-intensity' ? 1 : 0.1}
                        value={typeof item.value === 'number' ? item.value : 50}
                        onChange={(event) => {
                          if (item.id === 'haptic-intensity') {
                            onHapticIntensityChange(Number(event.target.value));
                          }
                        }}
                        className="w-24 accent-indigo-500"
                      />
                      <span className="text-white/50 text-sm w-8">
                        {typeof item.value === 'number' ? (item.value > 1 ? item.value : item.value.toFixed(1)) : item.value}
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        if (item.id !== 'emergency-contacts') return;
                        const seed = emergencyContacts
                          .map((contact) => `${contact.name}|${contact.phone}|${contact.email}`)
                          .join(',');
                        const nextRaw = window.prompt('Enter contacts: name|phone|email, separated by comma', seed);
                        if (nextRaw === null) return;

                        const parsedContacts = nextRaw
                          .split(',')
                          .map((token) => token.trim())
                          .filter((token) => token.length > 0)
                          .map((token) => {
                            const parts = token.split('|').map((part) => part.trim());
                            return {
                              name: parts[0] ?? 'Contact',
                              phone: parts[1] ?? '',
                              email: parts[2] ?? '',
                            } as EmergencyContact;
                          });

                        onEmergencyContactsChange(parsedContacts);
                      }}
                      className="flex items-center gap-2 text-white/50"
                    >
                      <span className="text-sm">{item.value}</span>
                      <div className="w-4 h-4"><Icons.ChevronRight /></div>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Haptic Patterns */}
        <div className="space-y-2">
          <h2 className="text-white/70 font-medium text-sm px-1">{tr('Haptic Patterns')}</h2>
          <div className="bg-white/5 rounded-2xl p-4 space-y-3">
            {HAPTIC_PATTERNS.slice(0, 5).map(pattern => (
              <div key={pattern.id} className="flex items-center justify-between">
                <div>
                  <div className="text-white text-sm font-medium">{pattern.name}</div>
                  <div className="text-white/40 text-xs">{pattern.description}</div>
                </div>
                <button className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 text-xs font-medium">
                  Test
                </button>
              </div>
            ))}
            <button className="w-full text-center text-indigo-400 text-sm py-2">
              {tr('View All Patterns ->')}
            </button>
          </div>
        </div>

        {/* About */}
        <div className="bg-white/5 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-medium">{tr('About')}</h3>
            <span className="text-white/50 text-sm">v2.0.0</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-white/50">{tr('Build')}</span>
              <span className="text-white/70">Phase 2 - Device Dashboard</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">{tr('Platform')}</span>
              <span className="text-white/70">{tr('Web Demo')}</span>
            </div>
          </div>
        </div>

        {/* Sign Out */}
        <button onClick={onSignOut} className="w-full py-4 rounded-2xl bg-red-500/10 text-red-400 font-medium">
          {tr('Sign Out')}
        </button>
      </div>
    </div>
  );
};

const RawDataScreen: React.FC<{
  sensorData: SensorData | null;
  language: AppLanguage;
  feedConnected: boolean;
  feedSourceLabel?: string;
  devices: Device[];
  onNavigate: (screen: string) => void;
}> = ({ sensorData, language, feedConnected, feedSourceLabel, devices, onNavigate }) => {
  const [changeFeed, setChangeFeed] = useState<Array<{ at: number; key: string; value: string }>>([]);
  const prevRef = useRef<SensorData | null>(null);
  const chestDevice = devices.find((d) => d.type === 'chest');
  const isConnected = feedConnected || chestDevice?.status === 'connected';
  const tr = useCallback((text: string) => translateText(language, text), [language]);

  useEffect(() => {
    if (!sensorData) return;

    const prev = prevRef.current;
    if (!prev) {
      prevRef.current = sensorData;
      return;
    }

    const changes: Array<{ at: number; key: string; value: string }> = [];
    const now = Date.now();
    const watch: Array<[string, number | boolean | null]> = [
      ['left', sensorData.left],
      ['center', sensorData.center],
      ['right', sensorData.right],
      ['front', sensorData.ground],
      ['far', sensorData.far],
      ['tofValid', sensorData.tof.valid],
      ['stepCount', sensorData.imuFlags.stepCount],
      ['stairsDetected', sensorData.imuFlags.stairsDetected],
      ['roughSurface', sensorData.imuFlags.roughSurface],
      ['fallDetected', sensorData.imuFlags.fallDetected],
      ['temperature', sensorData.environment.temperature],
      ['humidity', sensorData.environment.humidity],
    ];

    for (const [key, value] of watch) {
      const prevValue = (() => {
        switch (key) {
          case 'left': return prev.left;
          case 'center': return prev.center;
          case 'right': return prev.right;
          case 'front': return prev.ground;
          case 'far': return prev.far;
          case 'tofValid': return prev.tof.valid;
          case 'stepCount': return prev.imuFlags.stepCount;
          case 'stairsDetected': return prev.imuFlags.stairsDetected;
          case 'roughSurface': return prev.imuFlags.roughSurface;
          case 'fallDetected': return prev.imuFlags.fallDetected;
          case 'temperature': return prev.environment.temperature;
          case 'humidity': return prev.environment.humidity;
          default: return null;
        }
      })();

      if (prevValue !== value) {
        changes.push({ at: now, key, value: String(value) });
      }
    }

    if (changes.length > 0) {
      setChangeFeed((old) => [...changes, ...old].slice(0, 60));
    }

    prevRef.current = sensorData;
  }, [sensorData]);

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      <div className="sticky top-0 z-10 bg-gradient-to-b from-gray-900 via-gray-900 to-transparent pb-4 pt-safe">
        <div className="px-4 pt-4">
          <h1 className="text-2xl font-bold text-white">{tr('Raw Data')}</h1>
          <p className="text-white/50 text-sm">
            {isConnected ? (feedSourceLabel || tr('Live telemetry debug stream')) : tr('Connect chest device to view raw stream')}
          </p>
        </div>
      </div>

      <div className="px-4 space-y-4">
        {!isConnected ? (
          <div className="bg-white/5 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-4">
              <Icons.AlertTriangle />
            </div>
            <h3 className="text-white font-semibold mb-2">{tr('Chest Device Disconnected')}</h3>
            <p className="text-white/50 text-sm mb-4">{tr('Connect your chest device to inspect live raw telemetry')}</p>
            <button
              onClick={() => onNavigate('devices')}
              className="px-6 py-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 font-medium"
            >
              {tr('Go to Devices')}
            </button>
          </div>
        ) : (
          <>
            <div className="bg-gray-900 rounded-2xl p-4 font-mono text-sm border border-white/10">
              <div className="flex items-center justify-between mb-3">
                <span className="text-emerald-400">LIVE JSON FRAME</span>
                <span className="text-white/50">{sensorData ? formatTime(sensorData.timestamp) : '--:--:--'}</span>
              </div>
              <pre className="text-white/80 whitespace-pre-wrap break-all max-h-72 overflow-y-auto">
                {sensorData ? JSON.stringify(sensorData, null, 2) : 'Waiting for data...'}
              </pre>
            </div>

            <div className="bg-gray-900 rounded-2xl p-4 font-mono text-sm border border-white/10">
              <div className="flex items-center justify-between mb-3">
                <span className="text-cyan-400">RAW PACKET BYTES</span>
                <span className="text-white/50">AA + payload + checksum</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(sensorData?.rawPacket ?? []).map((byte, i) => (
                  <div key={i} className="px-2 py-1 rounded bg-white/10 text-white/80">
                    [{i}] 0x{byte.toString(16).toUpperCase().padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium">{tr('Live Change Feed')}</h3>
                <span className="text-xs text-white/50">{changeFeed.length} recent changes</span>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {changeFeed.length === 0 ? (
                  <div className="text-white/40 text-sm">{tr('Waiting for changing values...')}</div>
                ) : changeFeed.map((item, idx) => (
                  <div key={`${item.at}-${item.key}-${idx}`} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                    <span className="text-cyan-300 font-mono text-xs">{item.key}</span>
                    <span className="text-white/80 text-sm">{item.value}</span>
                    <span className="text-white/40 text-xs">{formatTime(item.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN APP
// ============================================================================

const App: React.FC = () => {
  // State
  const [isLoading, setIsLoading] = useState(true);
  const [currentScreen, setCurrentScreen] = useState('home');
  const [isWalking, setIsWalking] = useState(false);
  const [trips, setTrips] = useLocalStorage<Trip[]>('auraguard_trips', []);
  const [activeTripSummary, setActiveTripSummary] = useState<Trip | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('wired');
  const [wifiHostOverride, setWifiHostOverride] = useLocalStorage<string>('auraguard_wifi_host_override', '');
  const [appLanguage, setAppLanguage] = useLocalStorage<AppLanguage>('auraguard_language', 'English');
  const [hapticEnabled, setHapticEnabled] = useLocalStorage<boolean>('auraguard_haptic_enabled', true);
  const [hapticIntensity, setHapticIntensity] = useLocalStorage<number>('auraguard_haptic_intensity', 20);
  const [autoLaunchNavigation, setAutoLaunchNavigation] = useLocalStorage<boolean>('auraguard_auto_launch_nav', false);
  const [fallDetectionEnabled, setFallDetectionEnabled] = useLocalStorage<boolean>('auraguard_fall_detection_enabled', true);
  const [sosAutoCallEnabled, setSosAutoCallEnabled] = useLocalStorage<boolean>('auraguard_sos_autocall_enabled', false);
  const [emergencyContacts, setEmergencyContacts] = useLocalStorage<EmergencyContact[]>('auraguard_emergency_contacts', []);
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [appRole, setAppRole] = useState<AppRole>('user');
  const [profileName, setProfileName] = useState('Aura User');
  const [profileEmail, setProfileEmail] = useState('');
  const [relayEnabled, setRelayEnabled] = useState(true);
  const [monitorUserUid, setMonitorUserUid] = useState('');
  const [remoteSensorData, setRemoteSensorData] = useState<SensorData | null>(null);
  const [remoteFeedUpdatedAt, setRemoteFeedUpdatedAt] = useState(0);
  const [remoteFeedUserUid, setRemoteFeedUserUid] = useState('');
  const [remoteFeedOnline, setRemoteFeedOnline] = useState(false);
  const [remoteDeviceConnected, setRemoteDeviceConnected] = useState<boolean | null>(null);
  const [remoteLeftConnected, setRemoteLeftConnected] = useState<boolean | null>(null);
  const [remoteRightConnected, setRemoteRightConnected] = useState<boolean | null>(null);
  const [currentLocation, setCurrentLocation] = useState<UserLocation | null>(null);
  const [remoteLocation, setRemoteLocation] = useState<UserLocation | null>(null);
  const [locationPermission, setLocationPermission] = useState<'idle' | 'granted' | 'denied'>('idle');
  const [geofenceState, setGeofenceState] = useState<GeofenceState>({
    enabled: false,
    radiusM: GEOFENCE_DEFAULT_RADIUS_M,
    center: null,
    inside: true,
  });
  const [remoteGeofenceState, setRemoteGeofenceState] = useState<GeofenceState>({
    enabled: false,
    radiusM: GEOFENCE_DEFAULT_RADIUS_M,
    center: null,
    inside: true,
  });
  const [navigationSession, setNavigationSession] = useState<NavigationSession | null>(null);
  const [remoteNavigationSession, setRemoteNavigationSession] = useState<NavigationSession | null>(null);
  const [remoteUserName, setRemoteUserName] = useState('');
  const [linkedGuardianUids, setLinkedGuardianUids] = useState<string[]>([]);
  const tr = useCallback((text: string) => translateText(appLanguage, text), [appLanguage]);
  void locationPermission;

  const activeTripRef = useRef<ActiveTripState | null>(null);

  // Devices
  const [devices, setDevices] = useState<Device[]>([
    {
      id: 'chest-001',
      name: 'AuraGuard Chest',
      type: 'chest',
      status: 'disconnected',
      battery: 85,
      rssi: -65,
      lastSeen: Date.now(),
      firmwareVersion: 'v1.2.3',
      healthScore: 0,
      errorCount: 0,
      reconnectAttempts: 0,
      packetLoss: 0,
      latency: 0,
    },
    {
      id: 'left-001',
      name: 'AuraGuard Left Band',
      type: 'left_band',
      status: 'disconnected',
      battery: 72,
      rssi: -70,
      lastSeen: Date.now(),
      firmwareVersion: 'v1.1.0',
      healthScore: 0,
      errorCount: 0,
      reconnectAttempts: 0,
      packetLoss: 0,
      latency: 0,
    },
    {
      id: 'right-001',
      name: 'AuraGuard Right Band',
      type: 'right_band',
      status: 'disconnected',
      battery: 68,
      rssi: -72,
      lastSeen: Date.now(),
      firmwareVersion: 'v1.1.0',
      healthScore: 0,
      errorCount: 0,
      reconnectAttempts: 0,
      packetLoss: 0,
      latency: 0,
    },
  ]);

  // Sensor Data
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [sensorHistory, setSensorHistory] = useState<{
    left: number[];
    center: number[];
    right: number[];
    ground: number[];
    far: number[];
    accelMag: number[];
    temperature: number[];
    humidity: number[];
    stepCount: number[];
    tofValid: number[];
  }>({
    left: [],
    center: [],
    right: [],
    ground: [],
    far: [],
    accelMag: [],
    temperature: [],
    humidity: [],
    stepCount: [],
    tofValid: [],
  });

  // Device Logs
  const [deviceLogs, setDeviceLogs] = useState<DeviceLog[]>([]);

  // Refs for serial transport
  const serialPortRef = useRef<WebSerialPort | null>(null);
  const serialReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const serialReadAbortRef = useRef(false);
  const serialLineBufferRef = useRef('');
  const serialFrameRef = useRef<SerialFrameState>({});
  const lastSerialMessageAtRef = useRef(0);
  const staleFlagRef = useRef(false);
  const wifiSocketRef = useRef<WebSocket | null>(null);
  const wifiConnectedHostRef = useRef<string | null>(null);
  const wifiDisconnectIntentRef = useRef(false);
  const wifiPollIntervalRef = useRef<number | null>(null);
  const wifiPollingBusyRef = useRef(false);
  const wifiPollFailureCountRef = useRef(0);
  const wifiReconnectTimerRef = useRef<number | null>(null);
  const wifiTransportRef = useRef<'websocket' | 'polling' | null>(null);
  const relayLastPublishAtRef = useRef(0);
  const geolocationWatchIdRef = useRef<number | null>(null);
  const guardianLinkTargetRef = useRef('');
  const prevUserSignalRef = useRef<{ deviceConnected: boolean; fallDetected: boolean; geofenceInside: boolean } | null>(null);
  const prevGuardianSignalRef = useRef<{ deviceConnected: boolean; fallDetected: boolean; geofenceInside: boolean } | null>(null);
  const guardianNotifyAtRef = useRef(0);
  const sosHoldTimerRef = useRef<number | null>(null);
  const sosLastTriggeredAtRef = useRef(0);
  const lastNavLaunchKeyRef = useRef<string | null>(null);

  const chestDevice = devices.find((device) => device.type === 'chest');

  const buildTripSummary = useCallback((trip: ActiveTripState, endAt: number): Trip => {
    const durationMin = Math.max(1, Math.round((endAt - trip.startAt) / 60000));
    const distanceKm = Math.round(trip.distanceM / 10) / 100;
    const safetyScore = Math.max(50, Math.round(100 - (trip.obstacles * 5) - (trip.fallDetected ? 20 : 0)));

    return {
      id: trip.id,
      date: formatDate(trip.startAt),
      startTime: formatTime(trip.startAt),
      endTime: formatTime(endAt),
      distance: distanceKm,
      duration: durationMin,
      obstaclesDetected: trip.obstacles,
      safetyScore,
      routeName: trip.routeName,
    };
  }, []);

  const startWalk = useCallback(() => {
    const now = Date.now();
    const routeName = navigationSession?.destination?.label || 'Guided Walk';
    activeTripRef.current = {
      id: generateId(),
      startAt: now,
      lastLocation: currentLocation,
      distanceM: 0,
      obstacles: 0,
      lastObstacleAt: 0,
      fallDetected: false,
      routeName,
    };

    setActiveTripSummary(buildTripSummary(activeTripRef.current, now));
    setIsWalking(true);
  }, [buildTripSummary, currentLocation, navigationSession?.destination?.label]);

  const stopWalk = useCallback(() => {
    const trip = activeTripRef.current;
    setIsWalking(false);

    if (!trip) {
      setActiveTripSummary(null);
      return;
    }

    const now = Date.now();
    const summary = buildTripSummary(trip, now);
    setTrips([summary, ...trips].slice(0, TRIP_STORE_LIMIT));
    activeTripRef.current = null;
    setActiveTripSummary(null);
  }, [buildTripSummary, setTrips, trips]);

  useEffect(() => {
    let isMounted = true;
    let unsubscribeProfile: (() => void) | null = null;

    const clearProfileSubscription = () => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;

      clearProfileSubscription();

      if (!user) {
        setAuthUser(null);
        setAppRole('user');
        setProfileName('Aura User');
        setProfileEmail('');
        setRelayEnabled(true);
        setMonitorUserUid('');
        setRemoteSensorData(null);
        setRemoteFeedUpdatedAt(0);
        setRemoteFeedUserUid('');
        setRemoteFeedOnline(false);
        setRemoteDeviceConnected(null);
        setRemoteLeftConnected(null);
        setRemoteRightConnected(null);
        setRemoteLocation(null);
        setRemoteUserName('');
        setLinkedGuardianUids([]);
        setNavigationSession(null);
        setRemoteNavigationSession(null);
        prevUserSignalRef.current = null;
        prevGuardianSignalRef.current = null;
        setGeofenceState({
          enabled: false,
          radiusM: GEOFENCE_DEFAULT_RADIUS_M,
          center: null,
          inside: true,
        });
        setRemoteGeofenceState({
          enabled: false,
          radiusM: GEOFENCE_DEFAULT_RADIUS_M,
          center: null,
          inside: true,
        });
        setAuthReady(true);
        return;
      }

      if (!isMounted) return;

      setAuthUser(user);
      setProfileName(user.displayName || user.email?.split('@')[0] || 'Aura User');
      setProfileEmail(user.email || '');
      setAuthReady(true);

      const hintedRole: AppRole = (() => {
        if (typeof window === 'undefined') return 'user';
        return window.localStorage.getItem(ROLE_HINT_STORAGE_KEY) === 'guardian' ? 'guardian' : 'user';
      })();

      const profileRef = ref(db, `profiles/${user.uid}`);

      unsubscribeProfile = onValue(profileRef, (snapshot) => {
        if (!isMounted) return;

        const data = snapshot.val() as {
          role?: AppRole;
          monitorUserUid?: string;
          relayEnabled?: boolean;
          geofenceEnabled?: boolean;
          geofenceRadiusM?: number;
          geofenceCenter?: UserLocation | null;
        } | null;

        if (!snapshot.exists()) {
          setAppRole(hintedRole);
          setRelayEnabled(true);
          setMonitorUserUid('');
          setRemoteFeedOnline(false);

          void set(profileRef, {
            role: hintedRole,
            email: user.email || '',
            relayEnabled: true,
            monitorUserUid: '',
            geofenceEnabled: false,
            geofenceRadiusM: GEOFENCE_DEFAULT_RADIUS_M,
            geofenceCenter: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          if (typeof window !== 'undefined') {
            window.localStorage.setItem(ROLE_HINT_STORAGE_KEY, hintedRole);
          }

          return;
        }

        const resolvedRole: AppRole = data?.role === 'guardian' ? 'guardian' : 'user';
        setAppRole(resolvedRole);
        setRelayEnabled(data?.relayEnabled !== false);
        setMonitorUserUid(typeof data?.monitorUserUid === 'string' ? data.monitorUserUid : '');
        setGeofenceState((prev) => ({
          ...prev,
          enabled: data?.geofenceEnabled === true,
          radiusM: typeof data?.geofenceRadiusM === 'number' ? data.geofenceRadiusM : GEOFENCE_DEFAULT_RADIUS_M,
          center: data?.geofenceCenter ?? null,
        }));

        if (typeof window !== 'undefined') {
          window.localStorage.setItem(ROLE_HINT_STORAGE_KEY, resolvedRole);
        }
      });
    });

    return () => {
      isMounted = false;
      clearProfileSubscription();
      unsubscribeAuth();
    };
  }, []);

  // Add device log
  const addDeviceLog = useCallback((
    deviceId: string,
    deviceType: Device['type'],
    eventType: DeviceLog['eventType'],
    message: string,
    batteryAtEvent?: number
  ) => {
    setDeviceLogs(prev => [{
      id: generateId(),
      timestamp: Date.now(),
      deviceId,
      deviceType,
      eventType,
      message,
      batteryAtEvent,
    }, ...prev].slice(0, 100));
  }, []);

  const applySensorData = useCallback((newData: SensorData) => {
    setSensorData(newData);

    setSensorHistory((prev) => ({
      left: [...prev.left.slice(-SENSOR_HISTORY_LENGTH + 1), newData.left],
      center: [...prev.center.slice(-SENSOR_HISTORY_LENGTH + 1), newData.center],
      right: [...prev.right.slice(-SENSOR_HISTORY_LENGTH + 1), newData.right],
      ground: [...prev.ground.slice(-SENSOR_HISTORY_LENGTH + 1), newData.ground],
      far: [...prev.far.slice(-SENSOR_HISTORY_LENGTH + 1), newData.far],
      accelMag: [...prev.accelMag.slice(-SENSOR_HISTORY_LENGTH + 1), newData.imu.accelMag],
      temperature: [...prev.temperature.slice(-SENSOR_HISTORY_LENGTH + 1), newData.environment.temperature ?? 0],
      humidity: [...prev.humidity.slice(-SENSOR_HISTORY_LENGTH + 1), newData.environment.humidity ?? 0],
      stepCount: [...prev.stepCount.slice(-SENSOR_HISTORY_LENGTH + 1), newData.imuFlags.stepCount],
      tofValid: [...prev.tofValid.slice(-SENSOR_HISTORY_LENGTH + 1), newData.tof.valid ? 1 : 0],
    }));

    setDevices((prev) => prev.map((device) => {
      if (device.type !== 'chest') return device;

      const updated = {
        ...device,
        status: 'connected' as const,
        battery: newData.battery,
        lastSeen: newData.timestamp,
        reconnectAttempts: 0,
        latency: 0,
      };

      return {
        ...updated,
        healthScore: calculateHealthScore(updated),
      };
    }));
  }, []);

  useEffect(() => {
    if (!isWalking) return;
    const trip = activeTripRef.current;
    if (!trip) return;

    const now = Date.now();

    if (navigationSession?.destination?.label) {
      trip.routeName = navigationSession.destination.label;
    }

    if (currentLocation) {
      if (trip.lastLocation) {
        const delta = distanceMeters(trip.lastLocation, currentLocation);
        if (Number.isFinite(delta) && delta > 0 && delta < 200) {
          trip.distanceM += delta;
        }
      }
      trip.lastLocation = currentLocation;
    }

    if (sensorData) {
      const minDistance = Math.min(sensorData.left, sensorData.center, sensorData.right);
      if (minDistance <= TRIP_OBSTACLE_DISTANCE_CM && (now - trip.lastObstacleAt) > TRIP_OBSTACLE_COOLDOWN_MS) {
        trip.obstacles += 1;
        trip.lastObstacleAt = now;
      }

      if (sensorData.imuFlags.fallDetected) {
        trip.fallDetected = true;
      }
    }

    setActiveTripSummary(buildTripSummary(trip, now));
  }, [buildTripSummary, currentLocation, isWalking, navigationSession?.destination?.label, sensorData]);

  const applyWristsStatus = useCallback((leftConnected?: boolean, rightConnected?: boolean) => {
    setDevices((prev) => prev.map((device) => {
      if (device.type !== 'left_band' && device.type !== 'right_band') {
        return device;
      }

      if (device.type === 'left_band' && leftConnected === undefined) {
        return device;
      }
      if (device.type === 'right_band' && rightConnected === undefined) {
        return device;
      }

      const isConnected = device.type === 'left_band' ? leftConnected === true : rightConnected === true;
      const status = isConnected ? 'connected' as const : 'disconnected' as const;

      if (device.status !== status) {
        addDeviceLog(
          device.id,
          device.type,
          isConnected ? 'connected' : 'disconnected',
          `${device.name}: ${isConnected ? 'Connected' : 'Disconnected'} (from chest telemetry)`
        );
      }

      const updated = {
        ...device,
        status,
        lastSeen: Date.now(),
      };

      return {
        ...updated,
        healthScore: isConnected ? calculateHealthScore(updated) : 0,
      };
    }));
  }, [addDeviceLog]);

  const resetDeviceConnectionState = useCallback(() => {
    setDevices((prev) => prev.map((device) => {
      if (device.type === 'chest' || device.type === 'left_band' || device.type === 'right_band') {
        return {
          ...device,
          status: 'disconnected' as const,
          reconnectAttempts: 0,
          healthScore: 0,
        };
      }

      return device;
    }));
  }, []);

  const handleSignOut = useCallback(() => {
    void (async () => {
      try {
        await signOut(auth);
        setCurrentScreen('home');
      } catch {
        if (typeof window !== 'undefined') {
          window.alert(tr('Failed to sign out. Please try again.'));
        }
      }
    })();
  }, [tr]);

  const saveProfilePreferences = useCallback((patch: {
    relayEnabled?: boolean;
    monitorUserUid?: string;
    geofenceEnabled?: boolean;
    geofenceRadiusM?: number;
    geofenceCenter?: UserLocation | null;
  }) => {
    if (!authUser) return;

    void update(ref(db, `profiles/${authUser.uid}`), {
      ...patch,
      updatedAt: Date.now(),
    });
  }, [authUser]);

  const handleRelayEnabledChange = useCallback((enabled: boolean) => {
    setRelayEnabled(enabled);
    saveProfilePreferences({ relayEnabled: enabled });
  }, [saveProfilePreferences]);

  const handleMonitorUserUidChange = useCallback((value: string) => {
    const normalized = value.trim();
    const previousTarget = monitorUserUid.trim();

    setMonitorUserUid(normalized);
    saveProfilePreferences({ monitorUserUid: normalized });

    if (!authUser || appRole !== 'guardian') return;

    if (previousTarget && previousTarget !== normalized) {
      void remove(ref(db, `${GUARDIAN_LINKS_PATH}/${previousTarget}/${authUser.uid}`));
    }

    if (normalized) {
      void set(ref(db, `${GUARDIAN_LINKS_PATH}/${normalized}/${authUser.uid}`), true);
    }
  }, [appRole, authUser, monitorUserUid, saveProfilePreferences]);

  const startDirectionsForUser = useCallback((destination: { lat: number; lng: number; label: string }) => {
    if (!authUser || appRole !== 'guardian') return;

    const targetUid = monitorUserUid.trim();
    if (!targetUid || targetUid === authUser.uid) {
      if (typeof window !== 'undefined') {
        window.alert('Set a valid User Share ID first in Settings.');
      }
      return;
    }

    const nextSession: NavigationSession = {
      active: true,
      destination,
      startedByGuardianUid: authUser.uid,
      updatedAt: Date.now(),
    };

    setRemoteNavigationSession(nextSession);
    void set(ref(db, `${NAVIGATION_PATH}/${targetUid}`), nextSession);
  }, [appRole, authUser, monitorUserUid]);

  const stopDirectionsForUser = useCallback(() => {
    if (!authUser || appRole !== 'guardian') return;

    const targetUid = monitorUserUid.trim();
    if (!targetUid || targetUid === authUser.uid) return;

    setRemoteNavigationSession(null);
    void remove(ref(db, `${NAVIGATION_PATH}/${targetUid}`));
  }, [appRole, authUser, monitorUserUid]);

  const handleSetGeofenceCenter = useCallback(() => {
    if (!currentLocation) return;

    setGeofenceState((prev) => ({
      ...prev,
      center: currentLocation,
      inside: true,
    }));

    saveProfilePreferences({ geofenceCenter: currentLocation });
  }, [currentLocation, saveProfilePreferences]);

  const handleToggleGeofence = useCallback((enabled: boolean) => {
    setGeofenceState((prev) => {
      const center = enabled && !prev.center && currentLocation ? currentLocation : prev.center;
      return { ...prev, enabled, center };
    });

    saveProfilePreferences({
      geofenceEnabled: enabled,
      geofenceCenter: enabled ? (currentLocation ?? geofenceState.center) : geofenceState.center,
    });
  }, [currentLocation, geofenceState.center, saveProfilePreferences]);

  const requestGuardianNotificationPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!authUser) return;
    void requestGuardianNotificationPermission();
  }, [authUser, requestGuardianNotificationPermission]);

  const notifyGuardian = useCallback((title: string, body: string) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const now = Date.now();
    if ((now - guardianNotifyAtRef.current) < GUARDIAN_NOTIFY_COOLDOWN_MS) return;
    guardianNotifyAtRef.current = now;

    new Notification(title, { body });
  }, []);

  const sendSerialCommand = useCallback(async (command: string) => {
    const port = serialPortRef.current;
    if (!port?.writable) return false;

    const writer = port.writable.getWriter();
    try {
      const encoder = new TextEncoder();
      await writer.write(encoder.encode(command));
      return true;
    } catch {
      return false;
    } finally {
      writer.releaseLock();
    }
  }, []);

  const sendHapticIntensity = useCallback(async (value: number) => {
    const clamped = Math.max(0, Math.min(20, Math.round(value)));

    try {
      if (serialPortRef.current?.writable) {
        await sendSerialCommand(`HAPTIC_INTENSITY ${clamped}\n`);
        return;
      }

      const host = wifiConnectedHostRef.current;
      if (connectionMode === 'wifi' && host) {
        await fetchWithTimeout(`http://${host}/api/haptic/intensity?value=${clamped}`, {
          method: 'POST',
        }, WIFI_REQUEST_TIMEOUT_MS);
      }
    } catch {
      // Ignore failed haptic sync attempts when no hardware is connected.
    }
  }, [connectionMode, sendSerialCommand]);

  const sendHapticMute = useCallback(async (muted: boolean) => {
    const value = muted ? 1 : 0;

    try {
      if (serialPortRef.current?.writable) {
        await sendSerialCommand(`HAPTIC_MUTE ${value}\n`);
        return;
      }

      const host = wifiConnectedHostRef.current;
      if (connectionMode === 'wifi' && host) {
        await fetchWithTimeout(`http://${host}/api/haptic/mute?value=${value}`, {
          method: 'POST',
        }, WIFI_REQUEST_TIMEOUT_MS);
      }
    } catch {
      // Ignore failed haptic sync attempts when no hardware is connected.
    }
  }, [connectionMode, sendSerialCommand]);

  const emitAlertToGuardians = useCallback((payload: { type: string; title: string; body: string; data?: Record<string, unknown> }) => {
    if (!authUser || linkedGuardianUids.length === 0) return;

    const alertEnvelope = {
      type: payload.type,
      title: payload.title,
      body: payload.body,
      userUid: authUser.uid,
      userName: profileName,
      data: payload.data ?? null,
      createdAt: Date.now(),
    };

    linkedGuardianUids.forEach((guardianUid) => {
      void push(ref(db, `${GUARDIAN_ALERTS_PATH}/${guardianUid}`), alertEnvelope);
    });
  }, [authUser, linkedGuardianUids, profileName]);

  const formatLocationForAlert = (location: UserLocation | null): string => {
    if (!location) return 'Location unavailable';
    const accuracy = Number.isFinite(location.accuracy) ? ` ±${Math.round(location.accuracy)}m` : '';
    return `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}${accuracy}`;
  };

  const launchEmergencyDialer = useCallback(() => {
    if (!sosAutoCallEnabled || typeof window === 'undefined') return;
    const firstPhone = emergencyContacts
      .map((contact) => contact.phone.trim())
      .find((phone) => phone.length > 0);
    if (!firstPhone) return;
    window.location.href = `tel:${firstPhone}`;
  }, [emergencyContacts, sosAutoCallEnabled]);

  const triggerSos = useCallback((trigger: 'fall' | 'manual' | 'tactile') => {
    if (!authUser) return;

    const now = Date.now();
    if ((now - sosLastTriggeredAtRef.current) < SOS_COOLDOWN_MS) return;
    sosLastTriggeredAtRef.current = now;

    const leftStatus = devices.find((device) => device.type === 'left_band')?.status ?? 'disconnected';
    const rightStatus = devices.find((device) => device.type === 'right_band')?.status ?? 'disconnected';
    const locationText = formatLocationForAlert(currentLocation);

    emitAlertToGuardians({
      type: 'sos_emergency',
      title: 'SOS Emergency',
      body: `${profileName} triggered SOS (${trigger}). Location: ${locationText}`,
      data: {
        trigger,
        location: currentLocation,
        devices: {
          chest: chestDevice?.status ?? 'disconnected',
          left: leftStatus,
          right: rightStatus,
        },
        battery: sensorData?.battery ?? null,
        fallDetected: sensorData?.imuFlags.fallDetected ?? false,
        emergencyContacts,
        updatedAt: now,
      },
    });

    launchEmergencyDialer();
  }, [authUser, chestDevice?.status, currentLocation, devices, emergencyContacts, emitAlertToGuardians, launchEmergencyDialer, profileName, sensorData?.battery, sensorData?.imuFlags.fallDetected]);

  const startSosHold = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (sosHoldTimerRef.current !== null) return;
    sosHoldTimerRef.current = window.setTimeout(() => {
      sosHoldTimerRef.current = null;
      triggerSos('manual');
    }, SOS_HOLD_MS);
  }, [triggerSos]);

  const cancelSosHold = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (sosHoldTimerRef.current === null) return;
    window.clearTimeout(sosHoldTimerRef.current);
    sosHoldTimerRef.current = null;
  }, []);

  const handleHapticEnabledChange = useCallback((enabled: boolean) => {
    setHapticEnabled(enabled);
    void sendHapticMute(!enabled);
  }, [sendHapticMute, setHapticEnabled]);

  const handleHapticIntensityChange = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(20, Math.round(value)));
    setHapticIntensity(clamped);
    void sendHapticIntensity(clamped);
  }, [sendHapticIntensity, setHapticIntensity]);

  useEffect(() => {
    if (!authUser || appRole !== 'guardian') {
      guardianLinkTargetRef.current = '';
      return;
    }

    const monitorUid = monitorUserUid.trim();
    const previousTarget = guardianLinkTargetRef.current;

    if (previousTarget && previousTarget !== monitorUid) {
      void remove(ref(db, `${GUARDIAN_LINKS_PATH}/${previousTarget}/${authUser.uid}`));
    }

    if (monitorUid && monitorUid !== authUser.uid) {
      void set(ref(db, `${GUARDIAN_LINKS_PATH}/${monitorUid}/${authUser.uid}`), true);
    }

    guardianLinkTargetRef.current = monitorUid;
  }, [appRole, authUser, monitorUserUid]);

  useEffect(() => {
    if (!authUser || appRole !== 'user') {
      setLinkedGuardianUids([]);
      return;
    }

    const linksRef = ref(db, `${GUARDIAN_LINKS_PATH}/${authUser.uid}`);
    const unsubscribe = onValue(linksRef, (snapshot) => {
      const data = snapshot.val() as Record<string, boolean> | null;
      if (!data) {
        setLinkedGuardianUids([]);
        return;
      }

      const guardians = Object.entries(data)
        .filter(([, isLinked]) => isLinked === true)
        .map(([guardianUid]) => guardianUid);
      setLinkedGuardianUids(guardians);
    });

    return () => unsubscribe();
  }, [appRole, authUser]);

  useEffect(() => {
    if (!authUser || appRole !== 'guardian') return;

    void registerGuardianPushToken(authUser.uid, monitorUserUid.trim());
    const unsubscribe = subscribeForegroundPushMessages((payload) => {
      const title = payload.notification?.title ?? payload.data?.title ?? 'Guardian Alert';
      const body = payload.notification?.body ?? payload.data?.body ?? 'New update from monitored user.';
      notifyGuardian(title, body);
    });

    return () => unsubscribe();
  }, [appRole, authUser, monitorUserUid, notifyGuardian]);

  useEffect(() => {
    if (!authUser || appRole !== 'user') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationPermission('denied');
      return;
    }

    setLocationPermission('idle');

    geolocationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const nextLocation: UserLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: position.coords.speed,
          heading: position.coords.heading,
          timestamp: position.timestamp,
        };

        setCurrentLocation(nextLocation);
        setLocationPermission('granted');

        setGeofenceState((prev) => {
          if (!prev.enabled || !prev.center) {
            return prev;
          }

          const inside = distanceMeters(nextLocation, prev.center) <= prev.radiusM;
          return { ...prev, inside };
        });
      },
      () => {
        setLocationPermission('denied');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1500,
        timeout: 10000,
      },
    );

    return () => {
      if (geolocationWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(geolocationWatchIdRef.current);
      }
      geolocationWatchIdRef.current = null;
    };
  }, [appRole, authUser]);

  useEffect(() => {
    if (appRole !== 'user') return;
    if (!geofenceState.enabled || !geofenceState.center || !currentLocation) return;

    const inside = distanceMeters(currentLocation, geofenceState.center) <= geofenceState.radiusM;
    setGeofenceState((prev) => ({ ...prev, inside }));
  }, [appRole, currentLocation, geofenceState.center, geofenceState.enabled, geofenceState.radiusM]);

  useEffect(() => {
    if (!authUser) {
      setNavigationSession(null);
      setRemoteNavigationSession(null);
      return;
    }

    const targetUid = appRole === 'guardian' ? monitorUserUid.trim() : authUser.uid;
    if (!targetUid || (appRole === 'guardian' && targetUid === authUser.uid)) {
      setRemoteNavigationSession(null);
      return;
    }

    const navRef = ref(db, `${NAVIGATION_PATH}/${targetUid}`);
    const unsubscribe = onValue(navRef, (snapshot) => {
      if (!snapshot.exists()) {
        if (appRole === 'guardian') {
          setRemoteNavigationSession(null);
        } else {
          setNavigationSession(null);
        }
        return;
      }

      const payload = snapshot.val() as NavigationSession;
      if (appRole === 'guardian') {
        setRemoteNavigationSession(payload);
      } else {
        setNavigationSession(payload);
      }
    });

    return () => unsubscribe();
  }, [appRole, authUser, monitorUserUid]);

  const stopNativeNavigation = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await AuraNavigation.stopNavigation();
    } catch {
      // Ignore close failures if activity is already gone.
    }
  }, []);

  useEffect(() => {
    if (appRole !== 'user') return;

    if (!navigationSession?.active || !navigationSession.destination) {
      lastNavLaunchKeyRef.current = null;
      void stopNativeNavigation();
      return;
    }

    const key = `${navigationSession.destination.lat},${navigationSession.destination.lng},${navigationSession.updatedAt}`;
    if (lastNavLaunchKeyRef.current === key) return;
    lastNavLaunchKeyRef.current = key;

    if (Capacitor.isNativePlatform()) {
      const options: {
        destinationLat: number;
        destinationLng: number;
        destinationLabel?: string;
        originLat?: number;
        originLng?: number;
      } = {
        destinationLat: navigationSession.destination.lat,
        destinationLng: navigationSession.destination.lng,
        destinationLabel: navigationSession.destination.label,
      };

      if (currentLocation) {
        options.originLat = currentLocation.lat;
        options.originLng = currentLocation.lng;
      }

      void (async () => {
        try {
          await AuraNavigation.startWalkingNavigation(options);
        } catch (error) {
          console.error('Failed to start native Mapbox navigation', error);
        }
      })();
      return;
    }

    if (typeof window !== 'undefined') {
      window.alert('Mapbox native navigation is only available inside the Android app build.');
    }
  }, [appRole, currentLocation, navigationSession, stopNativeNavigation]);

  useEffect(() => {
    if (!authUser || appRole !== 'user' || !relayEnabled) return;

    const now = Date.now();
    if ((now - relayLastPublishAtRef.current) < 250) return;
    relayLastPublishAtRef.current = now;

    const geofencePayload: GeofenceState = {
      ...geofenceState,
      inside: geofenceState.enabled && geofenceState.center
        ? distanceMeters(currentLocation ?? geofenceState.center, geofenceState.center) <= geofenceState.radiusM
        : true,
    };

    const leftWristConnected = devices.find((device) => device.type === 'left_band')?.status === 'connected';
    const rightWristConnected = devices.find((device) => device.type === 'right_band')?.status === 'connected';

    const currentSignal = {
      deviceConnected: chestDevice?.status === 'connected',
      fallDetected: sensorData?.imuFlags.fallDetected === true,
      geofenceInside: geofencePayload.inside,
    };

    const previousSignal = prevUserSignalRef.current;
    if (previousSignal) {
      if (!previousSignal.deviceConnected && currentSignal.deviceConnected) {
        emitAlertToGuardians({
          type: 'device_connected',
          title: 'User Device Connected',
          body: `${profileName} chest device is connected.`,
        });
      }

      if (previousSignal.deviceConnected && !currentSignal.deviceConnected) {
        emitAlertToGuardians({
          type: 'device_disconnected',
          title: 'User Device Disconnected',
          body: `${profileName} chest device disconnected.`,
        });
      }

      if (fallDetectionEnabled && !previousSignal.fallDetected && currentSignal.fallDetected) {
        emitAlertToGuardians({
          type: 'fall_detected',
          title: 'Fall Detected',
          body: `Emergency: ${profileName} fall detection triggered.`,
          data: {
            location: currentLocation,
            deviceConnected: currentSignal.deviceConnected,
            fallDetected: true,
          },
        });
        triggerSos('fall');
      }

      if (previousSignal.geofenceInside && !currentSignal.geofenceInside) {
        emitAlertToGuardians({
          type: 'geofence_exit',
          title: 'Geofence Alert',
          body: `${profileName} moved outside geofence.`,
        });
      }
    }
    prevUserSignalRef.current = currentSignal;

    void set(ref(db, `${LIVE_FEED_PATH}/${authUser.uid}`), {
      userUid: authUser.uid,
      userName: profileName,
      updatedAt: now,
      deviceConnected: chestDevice?.status === 'connected',
      leftConnected: leftWristConnected,
      rightConnected: rightWristConnected,
      sensorData: sensorData ?? null,
      location: currentLocation,
      geofence: geofencePayload,
      navigation: navigationSession,
    });
  }, [appRole, authUser, chestDevice?.status, currentLocation, devices, emitAlertToGuardians, fallDetectionEnabled, geofenceState, navigationSession, profileName, relayEnabled, sensorData, triggerSos]);

  useEffect(() => {
    if (!authUser || appRole !== 'guardian') {
      setRemoteSensorData(null);
      setRemoteFeedUpdatedAt(0);
      setRemoteFeedUserUid('');
      setRemoteFeedOnline(false);
      setRemoteDeviceConnected(null);
      setRemoteLeftConnected(null);
      setRemoteRightConnected(null);
      setRemoteLocation(null);
      setRemoteUserName('');
      setRemoteGeofenceState({
        enabled: false,
        radiusM: GEOFENCE_DEFAULT_RADIUS_M,
        center: null,
        inside: true,
      });
      return;
    }

    const targetUid = monitorUserUid.trim();
    if (!targetUid || targetUid === authUser.uid) {
      setRemoteSensorData(null);
      setRemoteFeedUpdatedAt(0);
      setRemoteFeedUserUid('');
      setRemoteFeedOnline(false);
      setRemoteDeviceConnected(null);
      setRemoteLeftConnected(null);
      setRemoteRightConnected(null);
      setRemoteLocation(null);
      setRemoteUserName('');
      setRemoteGeofenceState({
        enabled: false,
        radiusM: GEOFENCE_DEFAULT_RADIUS_M,
        center: null,
        inside: true,
      });
      return;
    }

    void requestGuardianNotificationPermission();

    const liveRef = ref(db, `${LIVE_FEED_PATH}/${targetUid}`);
    const unsubscribe = onValue(liveRef, (snapshot) => {
      if (!snapshot.exists()) {
        setRemoteSensorData(null);
        setRemoteFeedUpdatedAt(0);
        setRemoteFeedUserUid('');
        setRemoteFeedOnline(false);
        setRemoteDeviceConnected(null);
        setRemoteLeftConnected(null);
        setRemoteRightConnected(null);
        setRemoteLocation(null);
        setRemoteUserName('');
        prevGuardianSignalRef.current = null;
        return;
      }

      const payload = snapshot.val() as Partial<LiveFeedEnvelope>;

      const updatedAt = typeof payload.updatedAt === 'number'
        ? payload.updatedAt
        : payload.sensorData?.timestamp ?? Date.now();

      setRemoteSensorData(payload.sensorData ?? null);
      setRemoteFeedUpdatedAt(updatedAt);
      setRemoteFeedUserUid(payload.userUid ?? targetUid);
      setRemoteUserName(payload.userName ?? '');
      setRemoteLocation(payload.location ?? null);
      setRemoteGeofenceState(payload.geofence ?? {
        enabled: false,
        radiusM: GEOFENCE_DEFAULT_RADIUS_M,
        center: null,
        inside: true,
      });
      setRemoteFeedOnline((Date.now() - updatedAt) <= LIVE_FEED_STALE_MS);
      setRemoteDeviceConnected(typeof payload.deviceConnected === 'boolean' ? payload.deviceConnected : null);
      setRemoteLeftConnected(typeof payload.leftConnected === 'boolean' ? payload.leftConnected : null);
      setRemoteRightConnected(typeof payload.rightConnected === 'boolean' ? payload.rightConnected : null);

      const currentSignal = {
        deviceConnected: payload.deviceConnected === true,
        fallDetected: payload.sensorData?.imuFlags.fallDetected ?? false,
        geofenceInside: payload.geofence?.inside ?? true,
      };

      const previousSignal = prevGuardianSignalRef.current;
      if (previousSignal) {
        if (!previousSignal.deviceConnected && currentSignal.deviceConnected) {
          notifyGuardian('User Device Connected', `${payload.userName ?? 'User'} chest device is connected.`);
        }

        if (previousSignal.deviceConnected && !currentSignal.deviceConnected) {
          notifyGuardian('User Device Disconnected', `${payload.userName ?? 'User'} chest device disconnected.`);
        }

        if (!previousSignal.fallDetected && currentSignal.fallDetected) {
          notifyGuardian('Fall Detected', `Emergency: ${payload.userName ?? 'User'} fall detection triggered.`);
        }

        if (previousSignal.geofenceInside && !currentSignal.geofenceInside) {
          notifyGuardian('Geofence Alert', `${payload.userName ?? 'User'} moved outside geofence.`);
        }
      }

      prevGuardianSignalRef.current = currentSignal;
    });

    return () => unsubscribe();
  }, [appRole, authUser, monitorUserUid, notifyGuardian, requestGuardianNotificationPermission]);

  useEffect(() => {
    if (appRole !== 'guardian') return;

    const timer = window.setInterval(() => {
      if (!remoteFeedUpdatedAt) {
        setRemoteFeedOnline(false);
        return;
      }

      setRemoteFeedOnline((Date.now() - remoteFeedUpdatedAt) <= LIVE_FEED_STALE_MS);
    }, 1500);

    return () => clearInterval(timer);
  }, [appRole, remoteFeedUpdatedAt]);

  useEffect(() => {
    if (appRole !== 'guardian' || !remoteFeedOnline || !remoteSensorData) return;

    setSensorHistory((prev) => ({
      left: [...prev.left.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.left],
      center: [...prev.center.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.center],
      right: [...prev.right.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.right],
      ground: [...prev.ground.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.ground],
      far: [...prev.far.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.far],
      accelMag: [...prev.accelMag.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.imu.accelMag],
      temperature: [...prev.temperature.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.environment.temperature ?? 0],
      humidity: [...prev.humidity.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.environment.humidity ?? 0],
      stepCount: [...prev.stepCount.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.imuFlags.stepCount],
      tofValid: [...prev.tofValid.slice(-SENSOR_HISTORY_LENGTH + 1), remoteSensorData.tof.valid ? 1 : 0],
    }));
  }, [appRole, remoteFeedOnline, remoteSensorData]);

  const closeSerialConnection = useCallback(async (reason?: string) => {
    serialReadAbortRef.current = true;

    if (serialReaderRef.current) {
      try {
        await serialReaderRef.current.cancel();
      } catch {
        // No-op when reader is already closed.
      }
      serialReaderRef.current = null;
    }

    if (serialPortRef.current) {
      try {
        await serialPortRef.current.close();
      } catch {
        // No-op when port is already closed.
      }
      serialPortRef.current = null;
    }

    serialLineBufferRef.current = '';
    serialFrameRef.current = {};
    staleFlagRef.current = false;
    lastSerialMessageAtRef.current = 0;
    resetDeviceConnectionState();

    if (reason) {
      addDeviceLog(chestDevice?.id ?? 'chest-001', 'chest', 'disconnected', reason);
    }
  }, [addDeviceLog, chestDevice?.id, resetDeviceConnectionState]);

  const closeWifiConnection = useCallback(async (reason?: string) => {
    wifiDisconnectIntentRef.current = true;

    const activeSocket = wifiSocketRef.current;
    wifiSocketRef.current = null;
    wifiConnectedHostRef.current = null;
    wifiTransportRef.current = null;

    if (wifiPollIntervalRef.current !== null) {
      clearInterval(wifiPollIntervalRef.current);
      wifiPollIntervalRef.current = null;
    }
    if (wifiReconnectTimerRef.current !== null) {
      clearTimeout(wifiReconnectTimerRef.current);
      wifiReconnectTimerRef.current = null;
    }
    wifiPollingBusyRef.current = false;
    wifiPollFailureCountRef.current = 0;

    if (activeSocket && (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING)) {
      try {
        activeSocket.close();
      } catch {
        // No-op when socket is already closing.
      }
    }

    staleFlagRef.current = false;
    lastSerialMessageAtRef.current = 0;
    applyWristsStatus(false, false);
    resetDeviceConnectionState();

    if (reason) {
      addDeviceLog(chestDevice?.id ?? 'chest-001', 'chest', 'disconnected', reason);
    }
  }, [addDeviceLog, applyWristsStatus, chestDevice?.id, resetDeviceConnectionState]);

  const connectDevice = useCallback((deviceId: string) => {
    const target = devices.find((device) => device.id === deviceId);
    if (!target || target.type !== 'chest') {
      return;
    }

    if (connectionMode === 'wifi') {
      if (wifiSocketRef.current || wifiPollIntervalRef.current !== null) {
        return;
      }

      if (wifiReconnectTimerRef.current !== null) {
        clearTimeout(wifiReconnectTimerRef.current);
        wifiReconnectTimerRef.current = null;
      }

      wifiDisconnectIntentRef.current = false;
      setIsScanning(true);

      setDevices((prev) => prev.map((device) => {
        if (device.id !== target.id) return device;
        return { ...device, status: 'connecting' as const };
      }));

      addDeviceLog(target.id, 'chest', 'connected', tr('Connecting to chest over Wi-Fi...'));

      void (async () => {
        try {
          if (serialPortRef.current) {
            await closeSerialConnection('Switched from USB to Wi-Fi mode');
          }

          const overrideHost = normalizeHostInput(wifiHostOverride);
          const hostCandidates = [overrideHost, ...WIFI_HOST_CANDIDATES]
            .map((host) => normalizeHostInput(host))
            .filter((host, index, list) => host.length > 0 && list.indexOf(host) === index);

          let socket: WebSocket | null = null;
          let connectedHost: string | null = null;
          let transport: 'websocket' | 'polling' | null = null;
          let lastFailure = 'Could not open any Wi-Fi telemetry endpoint';

          for (const host of hostCandidates) {
            try {
              try {
                await fetchWithTimeout(`http://${host}${WIFI_STATUS_PATH}`, {
                  method: 'GET',
                }, WIFI_REQUEST_TIMEOUT_MS);
              } catch {
                // Some firmware builds do not expose status endpoint or CORS.
              }

              const pollResponse = await fetchWithTimeout(`http://${host}${WIFI_SENSOR_POLL_PATH}`, {
                method: 'GET',
              }, WIFI_REQUEST_TIMEOUT_MS);

              if (!pollResponse.ok) {
                throw new Error(`HTTP polling failed on ${host}: ${pollResponse.status}`);
              }

              const payload = await pollResponse.text();
              const parsed = parseWifiTelemetry(payload, sensorData?.battery ?? 85);
              if (!parsed.sensorData) {
                throw new Error(`Invalid telemetry payload from ${host}`);
              }

              if (parsed.sosTriggered) {
                triggerSos('tactile');
              }

              if (!isPaused) {
                applySensorData(parsed.sensorData);
              }

              if (parsed.leftConnected !== undefined || parsed.rightConnected !== undefined) {
                applyWristsStatus(parsed.leftConnected, parsed.rightConnected);
              }

              transport = 'polling';

              connectedHost = host;
              break;
            } catch (error) {
              lastFailure = error instanceof Error ? error.message : 'Unknown Wi-Fi connection error';
            }
          }

          if (!connectedHost || !transport) {
            throw new Error(lastFailure);
          }

          wifiSocketRef.current = socket;
          wifiConnectedHostRef.current = connectedHost;
          wifiTransportRef.current = transport;
          staleFlagRef.current = false;
          lastSerialMessageAtRef.current = Date.now();

          void sendHapticIntensity(hapticIntensity);
          void sendHapticMute(!hapticEnabled);

          addDeviceLog(target.id, 'chest', 'connected', `Chest Wi-Fi connected to ${connectedHost} (${transport})`);

          setDevices((prev) => prev.map((device) => {
            if (device.type !== 'chest') return device;
            const updated = { ...device, status: 'connected' as const, lastSeen: Date.now() };
            return { ...updated, healthScore: calculateHealthScore(updated) };
          }));

          const pollHost = connectedHost;
          wifiPollIntervalRef.current = window.setInterval(() => {
            if (wifiPollingBusyRef.current) return;

            wifiPollingBusyRef.current = true;
            void (async () => {
              try {
                const response = await fetchWithTimeout(`http://${pollHost}${WIFI_SENSOR_POLL_PATH}`, {
                  method: 'GET',
                }, WIFI_REQUEST_TIMEOUT_MS);

                if (!response.ok) {
                  throw new Error(`Polling HTTP ${response.status}`);
                }

                const message = await response.text();
                staleFlagRef.current = false;
                lastSerialMessageAtRef.current = Date.now();
                wifiPollFailureCountRef.current = 0;

                const parsed = parseWifiTelemetry(message, sensorData?.battery ?? 85);
                if (parsed.sosTriggered) {
                  triggerSos('tactile');
                }
                if (parsed.leftConnected !== undefined || parsed.rightConnected !== undefined) {
                  applyWristsStatus(parsed.leftConnected, parsed.rightConnected);
                }

                if (parsed.sensorData && !isPaused) {
                  applySensorData(parsed.sensorData);
                }
              } catch {
                wifiPollFailureCountRef.current += 1;
                // Stale monitor will report if the stream stops.
              } finally {
                wifiPollingBusyRef.current = false;
              }
            })();
          }, WIFI_POLL_INTERVAL_MS);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown Wi-Fi error';
          const hint = getWifiFailureHint(message);
          addDeviceLog(target.id, 'chest', 'error', `Wi-Fi connection failed: ${message}. ${hint}`);
          setDevices((prev) => prev.map((device) => {
            if (device.type !== 'chest') return device;
            return { ...device, status: 'error' as const };
          }));

          if (typeof window !== 'undefined') {
            window.alert(`${tr('Wi-Fi connection failed:')} ${message}\n${hint}`);
          }
        } finally {
          setIsScanning(false);
        }
      })();

      return;
    }

    if (!isWebSerialSupported()) {
      addDeviceLog(target.id, 'chest', 'error', 'Web Serial is not supported in this browser. Use Chrome or Edge over HTTPS/localhost.');
      setDevices((prev) => prev.map((device) => {
        if (device.id !== target.id) return device;
        return { ...device, status: 'error' as const };
      }));
      return;
    }

    if (serialPortRef.current) {
      return;
    }

    serialReadAbortRef.current = false;
    setIsScanning(true);

    setDevices((prev) => prev.map((device) => {
      if (device.id !== target.id) return device;
      return { ...device, status: 'connecting' as const };
    }));

    addDeviceLog(target.id, 'chest', 'connected', tr('Select chest box serial port to connect...'));

    void (async () => {
      try {
        if (wifiSocketRef.current) {
          await closeWifiConnection('Switched from Wi-Fi to USB mode');
        }

        const serialApi = (navigator as NavigatorWithSerial).serial;
        if (!serialApi) {
          throw new Error('Web Serial API unavailable');
        }

        const port = await serialApi.requestPort();
        await port.open({ baudRate: WEB_SERIAL_BAUD_RATE });

        serialPortRef.current = port;
        lastSerialMessageAtRef.current = Date.now();

        void sendHapticIntensity(hapticIntensity);
        void sendHapticMute(!hapticEnabled);

        addDeviceLog(target.id, 'chest', 'connected', `Chest serial connected at ${WEB_SERIAL_BAUD_RATE} baud`);

        setDevices((prev) => prev.map((device) => {
          if (device.type !== 'chest') return device;
          const updated = { ...device, status: 'connected' as const, lastSeen: Date.now() };
          return { ...updated, healthScore: calculateHealthScore(updated) };
        }));

        const textDecoder = new TextDecoder();

        while (!serialReadAbortRef.current && port.readable) {
          const reader = port.readable.getReader();
          serialReaderRef.current = reader;

          try {
            while (!serialReadAbortRef.current) {
              const { value, done } = await reader.read();
              if (done) break;
              if (!value) continue;

              staleFlagRef.current = false;
              lastSerialMessageAtRef.current = Date.now();

              serialLineBufferRef.current += textDecoder.decode(value, { stream: true });
              const lines = serialLineBufferRef.current.split(/\r?\n/);
              serialLineBufferRef.current = lines.pop() ?? '';

              for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;

                const fallbackBattery = sensorData?.battery ?? 85;
                const parsed = parseSerialLine(line, serialFrameRef.current, fallbackBattery);
                serialFrameRef.current = parsed.frame;

                if (parsed.sosTriggered) {
                  triggerSos('tactile');
                }

                if (parsed.leftConnected !== undefined || parsed.rightConnected !== undefined) {
                  applyWristsStatus(parsed.leftConnected, parsed.rightConnected);
                }

                if (parsed.sensorData && !isPaused) {
                  applySensorData(parsed.sensorData);
                }
              }
            }
          } finally {
            reader.releaseLock();
            if (serialReaderRef.current === reader) {
              serialReaderRef.current = null;
            }
          }
        }
      } catch (error) {
        if (serialReadAbortRef.current) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unknown serial error';
        addDeviceLog(target.id, 'chest', 'error', `Serial connection failed: ${message}`);

        if (typeof window !== 'undefined') {
          const lower = message.toLowerCase();
          const portBusy = lower.includes('failed to open serial port') || lower.includes('access denied') || lower.includes('networkerror');

          if (portBusy) {
            window.alert(tr('Could not open COM port. Close Arduino Serial Monitor first, then click Connect USB again.'));
          } else {
            window.alert(`${tr('Serial connection failed:')} ${message}`);
          }
        }

        setDevices((prev) => prev.map((device) => {
          if (device.type !== 'chest') return device;
          return { ...device, status: 'error' as const };
        }));
      } finally {
        setIsScanning(false);

        if (!serialReadAbortRef.current) {
          await closeSerialConnection('Chest serial stream ended');
        }
      }
    })();
  }, [addDeviceLog, applySensorData, applyWristsStatus, closeSerialConnection, closeWifiConnection, connectionMode, devices, hapticEnabled, hapticIntensity, isPaused, sendHapticIntensity, sendHapticMute, sensorData?.battery, tr, triggerSos, wifiHostOverride]);

  const disconnectDevice = useCallback((deviceId: string) => {
    const target = devices.find((device) => device.id === deviceId);
    if (!target || target.type !== 'chest') return;

    if (connectionMode === 'wifi' || wifiSocketRef.current || wifiPollIntervalRef.current !== null) {
      void closeWifiConnection('Chest Wi-Fi disconnected');
    } else {
      void closeSerialConnection('Chest serial disconnected');
    }

    setIsScanning(false);
  }, [closeSerialConnection, closeWifiConnection, connectionMode, devices]);

  const handleConnectionModeChange = useCallback((mode: ConnectionMode) => {
    if (mode === connectionMode) return;

    setConnectionMode(mode);
    setIsScanning(false);
    staleFlagRef.current = false;
    lastSerialMessageAtRef.current = 0;

    if (serialPortRef.current) {
      void closeSerialConnection('USB disconnected due to mode change');
    }

    if (wifiSocketRef.current || wifiPollIntervalRef.current !== null) {
      void closeWifiConnection('Wi-Fi disconnected due to mode change');
    }
  }, [closeSerialConnection, closeWifiConnection, connectionMode]);

  const connectAllDevices = useCallback(() => {
    const chest = devices.find((device) => device.type === 'chest');
    if (!chest) return;
    connectDevice(chest.id);
  }, [connectDevice, devices]);

  const startScan = useCallback(() => {
    const chest = devices.find((device) => device.type === 'chest');
    if (!chest) return;

    if (chest.status === 'connected' || chest.status === 'connecting') {
      disconnectDevice(chest.id);
    } else {
      connectDevice(chest.id);
    }
  }, [connectDevice, devices, disconnectDevice]);

  useEffect(() => {
    return () => {
      void closeSerialConnection();
      void closeWifiConnection();
    };
  }, [closeSerialConnection, closeWifiConnection]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const activeTransport = serialPortRef.current ? 'serial' : (wifiTransportRef.current ? 'wifi' : null);
      if (!activeTransport || !lastSerialMessageAtRef.current) return;

      const staleTimeout = activeTransport === 'serial' ? SERIAL_STALE_TIMEOUT_MS : WIFI_STALE_TIMEOUT_MS;
      const isStale = (Date.now() - lastSerialMessageAtRef.current) > staleTimeout;
      if (!isStale) return;
      if (staleFlagRef.current) return;

      staleFlagRef.current = true;
      const transportLabel = activeTransport === 'serial' ? 'serial' : 'Wi-Fi';
      const staleSeconds = Math.round(staleTimeout / 1000);
      addDeviceLog(chestDevice?.id ?? 'chest-001', 'chest', 'error', `No ${transportLabel} telemetry from chest box in last ${staleSeconds}s`);

      if (typeof window !== 'undefined') {
        if (activeTransport === 'serial') {
          window.alert(tr('Connected to COM port but no sensor lines received in 5 seconds. Make sure chest box is running and Serial Monitor is closed.'));
        }
      }

      if (activeTransport === 'wifi') {
        setDevices((prev) => prev.map((device) => {
          if (device.type !== 'chest') return device;
          return { ...device, status: 'reconnecting' as const };
        }));

        addDeviceLog(chestDevice?.id ?? 'chest-001', 'chest', 'reconnecting', tr('Wi-Fi telemetry stalled. Attempting auto-reconnect...'));
        void closeWifiConnection('Chest Wi-Fi telemetry stalled');

        if (chestDevice?.id) {
          wifiReconnectTimerRef.current = window.setTimeout(() => {
            wifiReconnectTimerRef.current = null;
            connectDevice(chestDevice.id);
          }, 800);
        }
      } else {
        setDevices((prev) => prev.map((device) => {
          if (device.type !== 'chest') return device;
          return { ...device, status: 'error' as const };
        }));
      }

      applyWristsStatus(false, false);
    }, 1000);

    return () => clearInterval(interval);
  }, [addDeviceLog, applyWristsStatus, chestDevice?.id, closeWifiConnection, connectDevice, tr]);

  const guardianUsingRemoteFeed = appRole === 'guardian' && remoteFeedOnline && !!remoteSensorData;
  const effectiveSensorData = guardianUsingRemoteFeed ? remoteSensorData : sensorData;
  const effectiveFeedConnected = (chestDevice?.status === 'connected') || guardianUsingRemoteFeed;
  const effectiveLocation = appRole === 'guardian' ? remoteLocation : currentLocation;
  const effectiveDestination = appRole === 'guardian'
    ? (remoteNavigationSession?.active ? remoteNavigationSession.destination : null)
    : (navigationSession?.active ? navigationSession.destination : null);
  const effectiveGeofence = appRole === 'guardian' ? remoteGeofenceState : geofenceState;
  const feedSourceLabel = guardianUsingRemoteFeed
    ? `Remote feed from ${remoteUserName || remoteFeedUserUid || monitorUserUid}`
    : undefined;

  const resolveRemoteStatus = (flag: boolean | null): Device['status'] => {
    if (flag === true) return 'connected';
    if (flag === false) return 'disconnected';
    return remoteFeedOnline ? 'connecting' : 'disconnected';
  };

  const effectiveDevices = appRole === 'guardian'
    ? devices.map((device) => {
      if (device.type === 'chest') {
        const status = resolveRemoteStatus(remoteDeviceConnected);
        const battery = remoteSensorData?.battery ?? device.battery;
        const updated = {
          ...device,
          status,
          battery,
          lastSeen: remoteFeedUpdatedAt || device.lastSeen,
        };
        return {
          ...updated,
          healthScore: status === 'connected' ? calculateHealthScore(updated) : 0,
        };
      }

      if (device.type === 'left_band') {
        const status = resolveRemoteStatus(remoteLeftConnected);
        const updated = {
          ...device,
          status,
          lastSeen: remoteFeedUpdatedAt || device.lastSeen,
        };
        return {
          ...updated,
          healthScore: status === 'connected' ? calculateHealthScore(updated) : 0,
        };
      }

      const status = resolveRemoteStatus(remoteRightConnected);
      const updated = {
        ...device,
        status,
        lastSeen: remoteFeedUpdatedAt || device.lastSeen,
      };
      return {
        ...updated,
        healthScore: status === 'connected' ? calculateHealthScore(updated) : 0,
      };
    })
    : devices;

  // Navigation items
  const navItems = [
    { id: 'home', label: LANGUAGE_LABELS[appLanguage].home, icon: <Icons.Home />, roles: ['user', 'guardian'] as AppRole[] },
    { id: 'devices', label: LANGUAGE_LABELS[appLanguage].devices, icon: <Icons.Devices />, roles: ['user', 'guardian'] as AppRole[] },
    { id: 'sensors', label: LANGUAGE_LABELS[appLanguage].sensors, icon: <Icons.Sensors />, roles: ['user', 'guardian'] as AppRole[] },
    { id: 'raw', label: LANGUAGE_LABELS[appLanguage].raw, icon: <Icons.Cpu />, roles: ['guardian'] as AppRole[] },
    { id: 'settings', label: LANGUAGE_LABELS[appLanguage].settings, icon: <Icons.Settings />, roles: ['user', 'guardian'] as AppRole[] },
  ].filter((item) => item.roles.includes(appRole));

  useEffect(() => {
    if (!navItems.some((item) => item.id === currentScreen)) {
      setCurrentScreen('home');
    }
  }, [currentScreen, navItems]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-indigo-950 to-gray-900 text-white flex items-center justify-center">
        <p className="text-white/70">{tr('Preparing interface...')}</p>
      </div>
    );
  }

  if (!authUser) {
    return <AuthScreen language={appLanguage} onLanguageChange={setAppLanguage} />;
  }

  if (isLoading) {
    return <SplashScreen onComplete={() => setIsLoading(false)} language={appLanguage} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 text-white flex flex-col">
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {currentScreen === 'home' && (
          <HomeScreen
            devices={effectiveDevices}
            sensorData={effectiveSensorData}
            isWalking={isWalking}
              trips={trips}
              activeTrip={activeTripSummary}
            language={appLanguage}
            role={appRole}
            profileName={profileName}
            currentLocation={effectiveLocation}
            remoteFeedOnline={remoteFeedOnline}
            destination={effectiveDestination}
            geofence={effectiveGeofence}
            onStartDirections={startDirectionsForUser}
            onStopDirections={stopDirectionsForUser}
            onSetGeofenceCenter={handleSetGeofenceCenter}
            onToggleGeofence={handleToggleGeofence}
            onStartWalk={startWalk}
            onStopWalk={stopWalk}
            onSosHoldStart={startSosHold}
            onSosHoldCancel={cancelSosHold}
            onNavigate={setCurrentScreen}
          />
        )}
        {currentScreen === 'devices' && (
          <DeviceManagerScreen
            devices={effectiveDevices}
            deviceLogs={deviceLogs}
            isScanning={isScanning}
            language={appLanguage}
            connectionMode={connectionMode}
            wifiHostOverride={wifiHostOverride}
            onWifiHostOverrideChange={(value) => setWifiHostOverride(normalizeHostInput(value))}
            onConnectionModeChange={handleConnectionModeChange}
            onStartScan={startScan}
            onConnect={connectDevice}
            onDisconnect={disconnectDevice}
            onConnectAll={connectAllDevices}
            onNavigate={setCurrentScreen}
          />
        )}
        {currentScreen === 'sensors' && (
          <SensorLiveViewScreen
            sensorData={effectiveSensorData}
            language={appLanguage}
            feedConnected={effectiveFeedConnected}
            feedSourceLabel={feedSourceLabel}
            sensorHistory={sensorHistory}
            devices={effectiveDevices}
            isPaused={isPaused}
            onTogglePause={() => setIsPaused(!isPaused)}
            onNavigate={setCurrentScreen}
          />
        )}
        {currentScreen === 'raw' && (
          <RawDataScreen
            sensorData={effectiveSensorData}
            language={appLanguage}
            feedConnected={effectiveFeedConnected}
            feedSourceLabel={feedSourceLabel}
            devices={effectiveDevices}
            onNavigate={setCurrentScreen}
          />
        )}
        {currentScreen === 'settings' && (
          <SettingsScreen
            onNavigate={setCurrentScreen}
            language={appLanguage}
            userUid={authUser?.uid ?? ''}
            role={appRole}
            profileName={profileName}
            profileEmail={profileEmail}
            relayEnabled={relayEnabled}
            hapticEnabled={hapticEnabled}
            hapticIntensity={hapticIntensity}
            fallDetectionEnabled={fallDetectionEnabled}
            sosAutoCallEnabled={sosAutoCallEnabled}
            emergencyContacts={emergencyContacts}
            autoLaunchNavigation={autoLaunchNavigation}
            monitorUserUid={monitorUserUid}
            remoteFeedOnline={remoteFeedOnline}
            remoteFeedUserUid={remoteFeedUserUid}
            onSignOut={handleSignOut}
            onRelayEnabledChange={handleRelayEnabledChange}
            onHapticEnabledChange={handleHapticEnabledChange}
            onHapticIntensityChange={handleHapticIntensityChange}
            onFallDetectionEnabledChange={setFallDetectionEnabled}
            onSosAutoCallEnabledChange={setSosAutoCallEnabled}
            onEmergencyContactsChange={setEmergencyContacts}
            onAutoLaunchNavigationChange={setAutoLaunchNavigation}
            onMonitorUserUidChange={handleMonitorUserUidChange}
            onLanguageChange={setAppLanguage}
          />
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-xl border-t border-white/10 pb-safe">
        <div className="flex">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setCurrentScreen(item.id)}
              className={`flex-1 py-3 flex flex-col items-center gap-1 transition-all ${
                currentScreen === item.id
                  ? 'text-indigo-400'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              <div className={`w-6 h-6 transition-transform ${currentScreen === item.id ? 'scale-110' : ''}`}>
                {item.icon}
              </div>
              <span className="text-xs font-medium">{item.label}</span>
              {currentScreen === item.id && (
                <div className="absolute top-0 w-12 h-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Global Styles */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        .pt-safe {
          padding-top: env(safe-area-inset-top, 0);
        }
        .pb-safe {
          padding-bottom: env(safe-area-inset-bottom, 0);
        }
      `}</style>
    </div>
  );
};

export default App;
