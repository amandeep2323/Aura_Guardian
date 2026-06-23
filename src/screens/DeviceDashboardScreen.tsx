import { useAppStore } from '../stores/appStore';
import { useWifiStore } from '../stores/wifiStore';
import { 
  ArrowLeft, 
  Cpu, 
  Watch, 
  Activity,
  Zap,
  Footprints
} from 'lucide-react';
import Button from '../components/common/Button';
import BatteryIndicator from '../components/device/BatteryIndicator';
import SignalStrengthBar from '../components/device/SignalStrengthBar';
import { getDistanceZone, getZoneColor, formatDistance } from '../models/SensorData';

export default function DeviceDashboardScreen() {
  const { navigateTo, goBack } = useAppStore();
  const { connectedDevices, sensorData, isConnected } = useWifiStore();

  // Get specific devices
  const chestDevice = connectedDevices.find(d => d.type === 'chest');
  const leftBand = connectedDevices.find(d => d.type === 'left_band');
  const rightBand = connectedDevices.find(d => d.type === 'right_band');

  // Calculate average health score
  const avgHealth = connectedDevices.length > 0
    ? Math.round(connectedDevices.reduce((sum, d) => sum + d.battery, 0) / connectedDevices.length)
    : 0;

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
            <h1 className="text-xl font-bold text-white">Device Dashboard</h1>
            <p className="text-sm text-gray-400">
              {connectedDevices.length} device{connectedDevices.length !== 1 ? 's' : ''} connected
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-6 overflow-auto">
        {/* Overall Health Card */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/20">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">System Health</h2>
              <p className="text-sm text-gray-400">Overall battery status</p>
            </div>
            <div className="text-3xl font-bold text-white">{avgHealth}%</div>
          </div>
          
          {/* Health bar */}
          <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500"
              style={{ width: `${avgHealth}%` }}
            />
          </div>
        </div>

        {/* Devices Grid */}
        <section>
          <h2 className="text-sm font-medium text-gray-400 mb-3">DEVICES</h2>
          <div className="space-y-3">
            {/* Chest Unit */}
            <div className={`p-4 rounded-xl ${chestDevice ? 'bg-gray-800' : 'bg-gray-800/50'} border ${chestDevice ? 'border-green-500/30' : 'border-gray-700'}`}>
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center ${chestDevice ? 'bg-green-500/20' : 'bg-gray-700'}`}>
                  <Cpu className={`w-7 h-7 ${chestDevice ? 'text-green-400' : 'text-gray-500'}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-white">Chest Unit</h3>
                  <p className="text-sm text-gray-400">
                    {chestDevice ? chestDevice.name : 'Not connected'}
                  </p>
                </div>
                {chestDevice && (
                  <div className="flex items-center gap-3">
                    <BatteryIndicator percent={chestDevice.battery} size="md" />
                    <SignalStrengthBar rssi={chestDevice.rssi} size="md" />
                  </div>
                )}
              </div>
              
              {chestDevice && (
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  className="mt-3"
                  onClick={() => navigateTo('sensorLiveView')}
                >
                  <Activity className="w-4 h-4 mr-2" />
                  View Live Sensors
                </Button>
              )}
            </div>

            {/* Left Wrist Band */}
            <div className={`p-4 rounded-xl ${leftBand ? 'bg-gray-800' : 'bg-gray-800/50'} border ${leftBand ? 'border-green-500/30' : 'border-gray-700'}`}>
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center ${leftBand ? 'bg-blue-500/20' : 'bg-gray-700'}`}>
                  <Watch className={`w-7 h-7 ${leftBand ? 'text-blue-400' : 'text-gray-500'}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-white">Left Wrist Band</h3>
                  <p className="text-sm text-gray-400">
                    {leftBand ? leftBand.name : 'Not connected'}
                  </p>
                </div>
                {leftBand && (
                  <div className="flex items-center gap-3">
                    <BatteryIndicator percent={leftBand.battery} size="md" />
                    <SignalStrengthBar rssi={leftBand.rssi} size="md" />
                  </div>
                )}
              </div>
            </div>

            {/* Right Wrist Band */}
            <div className={`p-4 rounded-xl ${rightBand ? 'bg-gray-800' : 'bg-gray-800/50'} border ${rightBand ? 'border-green-500/30' : 'border-gray-700'}`}>
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center ${rightBand ? 'bg-purple-500/20' : 'bg-gray-700'}`}>
                  <Watch className={`w-7 h-7 ${rightBand ? 'text-purple-400' : 'text-gray-500'}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-white">Right Wrist Band</h3>
                  <p className="text-sm text-gray-400">
                    {rightBand ? rightBand.name : 'Not connected'}
                  </p>
                </div>
                {rightBand && (
                  <div className="flex items-center gap-3">
                    <BatteryIndicator percent={rightBand.battery} size="md" />
                    <SignalStrengthBar rssi={rightBand.rssi} size="md" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Quick Sensor Overview */}
        {isConnected && (
          <section>
            <h2 className="text-sm font-medium text-gray-400 mb-3">CURRENT READINGS</h2>
            <div className="grid grid-cols-2 gap-3">
              {/* Left Distance */}
              <div className="p-4 rounded-xl bg-gray-800">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getZoneColor(getDistanceZone(sensorData.leftDistance)) }} />
                  <span className="text-sm text-gray-400">Left</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {formatDistance(sensorData.leftDistance)}
                </p>
              </div>

              {/* Right Distance */}
              <div className="p-4 rounded-xl bg-gray-800">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getZoneColor(getDistanceZone(sensorData.rightDistance)) }} />
                  <span className="text-sm text-gray-400">Right</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {formatDistance(sensorData.rightDistance)}
                </p>
              </div>

              {/* Center Distance */}
              <div className="p-4 rounded-xl bg-gray-800">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getZoneColor(getDistanceZone(sensorData.centerDistance)) }} />
                  <span className="text-sm text-gray-400">Center</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {formatDistance(sensorData.centerDistance)}
                </p>
              </div>

              {/* Ground Distance */}
              <div className="p-4 rounded-xl bg-gray-800">
                <div className="flex items-center gap-2 mb-2">
                  <Footprints className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-400">Ground</span>
                </div>
                <p className="text-2xl font-bold text-white">
                  {sensorData.groundDistance}cm
                </p>
              </div>
            </div>
          </section>
        )}

        {/* IMU Status */}
        {isConnected && (
          <section>
            <h2 className="text-sm font-medium text-gray-400 mb-3">IMU STATUS</h2>
            <div className="p-4 rounded-xl bg-gray-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  <span className="text-white">Step Count</span>
                </div>
                <span className="text-xl font-bold text-white">{sensorData.stepCount}</span>
              </div>
              
              <div className="mt-4 flex gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  sensorData.stairsDetected 
                    ? 'bg-blue-500/20 text-blue-400' 
                    : 'bg-gray-700 text-gray-500'
                }`}>
                  Stairs: {sensorData.stairsDetected ? 'Yes' : 'No'}
                </span>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  sensorData.roughSurface 
                    ? 'bg-orange-500/20 text-orange-400' 
                    : 'bg-gray-700 text-gray-500'
                }`}>
                  Rough: {sensorData.roughSurface ? 'Yes' : 'No'}
                </span>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  sensorData.fallDetected 
                    ? 'bg-red-500/20 text-red-400' 
                    : 'bg-gray-700 text-gray-500'
                }`}>
                  Fall: {sensorData.fallDetected ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* Not Connected Message */}
        {!isConnected && (
          <div className="flex flex-col items-center justify-center py-12">
            <Cpu className="w-16 h-16 text-gray-600 mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">No Devices Connected</h3>
            <p className="text-gray-400 text-center mb-4">
              Connect your devices to see sensor data
            </p>
            <Button
              variant="primary"
              onClick={() => navigateTo('deviceManager')}
            >
              Connect Devices
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

