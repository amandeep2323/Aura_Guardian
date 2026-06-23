import { useState, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useWifiStore } from '../stores/wifiStore';
import { 
  ArrowLeft, 
  Wifi,
  WifiOff,
  RefreshCw,
  Smartphone,
  Watch,
  Cpu,
  CheckCircle,
  XCircle,
  Loader2,
  Info
} from 'lucide-react';
import Button from '../components/common/Button';
import BatteryIndicator from '../components/device/BatteryIndicator';
import SignalStrengthBar from '../components/device/SignalStrengthBar';
import type { DeviceType } from '../models/Device';

export default function DeviceManagerScreen() {
  const { goBack, navigateTo } = useAppStore();
  const { 
    isScanning, 
    scanResults, 
    connectedDevices,
    isConnecting,
    connectionError,
    startScan,
    stopScan,
    connectDevice,
    disconnectDevice,
    clearError
  } = useWifiStore();

  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  // Auto-start scan when screen loads
  useEffect(() => {
    startScan();
    return () => stopScan();
  }, []);

  // Get icon for device type
  const getDeviceIcon = (type: DeviceType) => {
    switch (type) {
      case 'chest':
        return Cpu;
      case 'left_band':
      case 'right_band':
        return Watch;
      default:
        return Smartphone;
    }
  };

  // Identify device type from name
  const identifyDeviceType = (name: string): DeviceType => {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('chest') || lowerName.includes('main')) return 'chest';
    if (lowerName.includes('left')) return 'left_band';
    if (lowerName.includes('right')) return 'right_band';
    return 'chest'; // Default
  };

  // Handle device connection
  const handleConnect = async (deviceId: string, deviceName: string) => {
    setSelectedDevice(deviceId);
    clearError();
    await connectDevice(deviceId, identifyDeviceType(deviceName));
  };

  // Handle device disconnection
  const handleDisconnect = async (deviceId: string) => {
    await disconnectDevice(deviceId);
  };

  // Check if device is already connected
  const isDeviceConnected = (deviceId: string) => {
    return connectedDevices.some((d) => d.id === deviceId);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
        <div className="flex items-center gap-4 p-4">
          <button
            onClick={goBack}
            className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Device Manager</h1>
            <p className="text-sm text-gray-400">Connect your Aura Guardian ESP32 devices</p>
          </div>
          <button
            onClick={() => isScanning ? stopScan() : startScan()}
            className={`p-3 rounded-full transition-colors ${
              isScanning 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
            }`}
            aria-label={isScanning ? 'Stop Wi-Fi discovery' : 'Start Wi-Fi discovery'}
          >
            {isScanning ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Wifi className="w-5 h-5" />
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-6">
        {/* Connection Error */}
        {connectionError && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
            <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-red-400 text-sm">{connectionError}</p>
            <button 
              onClick={clearError}
              className="ml-auto text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          </div>
        )}

        {/* Connected Devices Section */}
        <section>
          <h2 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            CONNECTED DEVICES ({connectedDevices.length}/3)
          </h2>
          
          {connectedDevices.length === 0 ? (
            <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700 text-center">
              <WifiOff className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-gray-500">No devices connected</p>
              <p className="text-sm text-gray-600 mt-1">
                Discover and connect to your devices below
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {connectedDevices.map((device) => {
                const Icon = getDeviceIcon(device.type);
                return (
                  <div
                    key={device.id}
                    className="p-4 rounded-xl bg-gray-800 border border-green-500/30"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                        <Icon className="w-6 h-6 text-green-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-white truncate">
                          {device.name}
                        </h3>
                        <p className="text-sm text-gray-400 capitalize">
                          {device.type.replace('_', ' ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <BatteryIndicator percent={device.battery} size="sm" />
                        <SignalStrengthBar rssi={device.rssi} size="sm" />
                      </div>
                    </div>
                    
                    <div className="flex gap-2 mt-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        fullWidth
                        onClick={() => navigateTo('sensorLiveView')}
                      >
                        Live View
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDisconnect(device.id)}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Available Devices Section */}
        <section>
          <h2 className="text-sm font-medium text-gray-400 mb-3 flex items-center gap-2">
            <Wifi className="w-4 h-4 text-blue-500" />
            AVAILABLE DEVICES
            {isScanning && (
              <span className="ml-2 text-xs text-blue-400 animate-pulse">
                Discovering...
              </span>
            )}
          </h2>

          {scanResults.length === 0 ? (
            <div className="p-6 rounded-xl bg-gray-800/50 border border-gray-700 text-center">
              {isScanning ? (
                <>
                  <Loader2 className="w-8 h-8 text-blue-500 mx-auto mb-2 animate-spin" />
                  <p className="text-gray-400">Searching on local Wi-Fi...</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Make sure ESP32 devices are on the same network
                  </p>
                </>
              ) : (
                <>
                  <WifiOff className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-500">No devices found</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={startScan}
                    className="mt-3"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Discover Again
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {scanResults
                .filter(device => !isDeviceConnected(device.id))
                .map((device) => {
                  const deviceType = identifyDeviceType(device.name);
                  const Icon = getDeviceIcon(deviceType);
                  const isConnectingThis = isConnecting && selectedDevice === device.id;

                  return (
                    <button
                      key={device.id}
                      onClick={() => handleConnect(device.id, device.name)}
                      disabled={isConnecting}
                      className="w-full p-4 rounded-xl bg-gray-800 border border-gray-700 hover:border-blue-500/50 transition-colors text-left disabled:opacity-50"
                      aria-label={`Connect to ${device.name}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                          {isConnectingThis ? (
                            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                          ) : (
                            <Icon className="w-6 h-6 text-blue-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-white truncate">
                            {device.name}
                          </h3>
                          <p className="text-sm text-gray-400">
                            {isConnectingThis ? 'Connecting...' : 'Tap to connect'}
                          </p>
                        </div>
                        <SignalStrengthBar rssi={device.rssi} size="sm" />
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </section>

        {/* Help Section */}
        <section className="p-4 rounded-xl bg-gray-800/50 border border-gray-700">
          <div className="flex gap-3">
            <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-white mb-1">Connection Tips</h3>
              <ul className="text-sm text-gray-400 space-y-1">
                <li>• Ensure all devices are powered on</li>
                <li>• Keep phone and ESP32 devices on the same Wi-Fi</li>
                <li>• Connect chest unit first</li>
                <li>• Device names should contain "AuraGuard"</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

