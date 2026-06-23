import { create } from 'zustand';
import type { Device, DeviceType, ScanResult } from '../models/Device';
import type { SensorData } from '../models/SensorData';

// Mock Wi-Fi discovery results for demo
const MOCK_DISCOVERY_RESULTS: ScanResult[] = [
  { id: 'esp32-chest.local', name: 'AuraGuard-Chest', rssi: -45, serviceEndpoints: ['/ws/sensor', '/api/system/status'] },
  { id: 'esp32-left.local', name: 'AuraGuard-Left', rssi: -52, serviceEndpoints: ['/api/haptic/left'] },
  { id: 'esp32-right.local', name: 'AuraGuard-Right', rssi: -48, serviceEndpoints: ['/api/haptic/right'] },
];

// Initial sensor data (all clear)
const INITIAL_SENSOR_DATA: SensorData = {
  header: 0xAA,
  leftDistance: 255,
  centerDistance: 255,
  rightDistance: 255,
  groundDistance: 30,
  farDistance: 400,
  batteryPercent: 85,
  imuFlags: 0,
  stepCount: 0,
  fallDetected: false,
  stairsDetected: false,
  roughSurface: false,
  timestamp: Date.now(),
  isValid: true,
};

export interface WifiState {
  // Scanning state
  isScanning: boolean;
  scanResults: ScanResult[];
  
  // Connection state
  isConnecting: boolean;
  isConnected: boolean;
  connectedDevices: Device[];
  connectionError: string | null;
  
  // Sensor data
  sensorData: SensorData;
  sensorHistory: SensorData[];
  
  // Actions
  startScan: () => void;
  stopScan: () => void;
  connectDevice: (deviceId: string, type: DeviceType) => Promise<void>;
  disconnectDevice: (deviceId: string) => Promise<void>;
  disconnectAll: () => void;
  clearError: () => void;
  updateSensorData: (data: SensorData) => void;
  
  // Haptic control
  sendHapticCommand: (side: 'left' | 'right', pattern: number, intensity: number) => Promise<void>;
}

export const useWifiStore = create<WifiState>((set, get) => ({
  // Initial state
  isScanning: false,
  scanResults: [],
  isConnecting: false,
  isConnected: false,
  connectedDevices: [],
  connectionError: null,
  sensorData: INITIAL_SENSOR_DATA,
  sensorHistory: [],

  // Start Wi-Fi discovery
  startScan: () => {
    set({ isScanning: true, scanResults: [] });
    
    // Simulate finding devices over time
    setTimeout(() => {
      set({ scanResults: [MOCK_DISCOVERY_RESULTS[0]] });
    }, 500);
    
    setTimeout(() => {
      set({ scanResults: [MOCK_DISCOVERY_RESULTS[0], MOCK_DISCOVERY_RESULTS[1]] });
    }, 1200);
    
    setTimeout(() => {
      set({ scanResults: MOCK_DISCOVERY_RESULTS, isScanning: false });
    }, 2000);
  },

  // Stop Wi-Fi discovery
  stopScan: () => {
    set({ isScanning: false });
  },

  // Connect to a device
  connectDevice: async (deviceId: string, type: DeviceType) => {
    const { scanResults, connectedDevices } = get();
    
    // Check if already connected
    if (connectedDevices.some(d => d.id === deviceId)) {
      return;
    }
    
    // Find device in scan results
    const scanResult = scanResults.find(r => r.id === deviceId);
    if (!scanResult) {
      set({ connectionError: 'Device not found' });
      return;
    }
    
    set({ isConnecting: true, connectionError: null });
    
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Simulate occasional connection failure (10% chance)
    if (Math.random() < 0.1) {
      set({ 
        isConnecting: false, 
        connectionError: 'Connection failed. Please try again.' 
      });
      return;
    }
    
    // Create connected device
    const newDevice: Device = {
      id: scanResult.id,
      name: scanResult.name,
      type,
      status: 'connected',
      battery: 75 + Math.floor(Math.random() * 25),
      rssi: scanResult.rssi,
      lastSeen: new Date(),
      isConnected: true,
    };
    
    const updatedDevices = [...connectedDevices, newDevice];
    
    set({ 
      isConnecting: false,
      isConnected: true,
      connectedDevices: updatedDevices,
    });
    
    // Start simulating sensor data if chest is connected
    if (type === 'chest') {
      startSensorSimulation(get);
    }
  },

  // Disconnect from a device
  disconnectDevice: async (deviceId: string) => {
    const { connectedDevices } = get();
    
    // Simulate disconnection delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const updatedDevices = connectedDevices.filter(d => d.id !== deviceId);
    
    set({
      connectedDevices: updatedDevices,
      isConnected: updatedDevices.length > 0,
    });
  },

  // Disconnect all devices
  disconnectAll: () => {
    set({
      connectedDevices: [],
      isConnected: false,
      sensorData: INITIAL_SENSOR_DATA,
      sensorHistory: [],
    });
  },

  // Clear connection error
  clearError: () => {
    set({ connectionError: null });
  },

  // Update sensor data
  updateSensorData: (data: SensorData) => {
    const { sensorHistory } = get();
    
    // Keep last 100 readings
    const newHistory = [...sensorHistory, data].slice(-100);
    
    set({
      sensorData: data,
      sensorHistory: newHistory,
    });
  },

  // Send haptic command to wrist bands
  sendHapticCommand: async (side: 'left' | 'right', pattern: number, intensity: number) => {
    const { connectedDevices } = get();
    
    const bandType = side === 'left' ? 'left_band' : 'right_band';
    const band = connectedDevices.find(d => d.type === bandType);
    
    if (!band) {
      console.warn(`${side} band not connected`);
      return;
    }
    
    // In real implementation, this would call the ESP32 Wi-Fi endpoint
    console.log(`Sending haptic: ${side} band, pattern ${pattern}, intensity ${intensity}`);
    
    // Simulate command send
    await new Promise(resolve => setTimeout(resolve, 50));
  },
}));

// Sensor data simulation (for demo purposes)
let sensorSimulationInterval: number | null = null;

function startSensorSimulation(get: () => WifiState) {
  // Clear any existing simulation
  if (sensorSimulationInterval) {
    clearInterval(sensorSimulationInterval);
  }
  
  sensorSimulationInterval = window.setInterval(() => {
    const { connectedDevices, updateSensorData } = get();
    
    // Stop if chest is disconnected
    if (!connectedDevices.some(d => d.type === 'chest')) {
      if (sensorSimulationInterval) {
        clearInterval(sensorSimulationInterval);
        sensorSimulationInterval = null;
      }
      return;
    }
    
    // Generate simulated sensor data
    const newData: SensorData = {
      header: 0xAA,
      leftDistance: randomDistance(50, 300),
      centerDistance: randomDistance(100, 400),
      rightDistance: randomDistance(50, 300),
      groundDistance: randomDistance(25, 35),
      farDistance: randomDistance(200, 400),
      batteryPercent: 85 - Math.floor(Math.random() * 5),
      imuFlags: 0,
      stepCount: Math.floor(Math.random() * 32),
      fallDetected: false,
      stairsDetected: Math.random() < 0.02,
      roughSurface: Math.random() < 0.1,
      timestamp: Date.now(),
      isValid: true,
    };
    
    updateSensorData(newData);
  }, 100); // 10Hz update rate (100ms)
}

// Helper to generate random distance with some variance
function randomDistance(min: number, max: number): number {
  const base = min + Math.random() * (max - min);
  const variance = (Math.random() - 0.5) * 20;
  return Math.max(0, Math.min(255, Math.round(base + variance)));
}

