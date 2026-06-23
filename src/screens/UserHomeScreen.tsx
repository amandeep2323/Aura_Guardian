import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useWifiStore } from '../stores/wifiStore';
import { 
  Play, 
  Eye, 
  Settings, 
  Wifi,
  Battery, 
  MapPin,
  Home,
  Briefcase,
  Building2,
  Phone,
  WifiOff
} from 'lucide-react';
import Button from '../components/common/Button';

export default function UserHomeScreen() {
  const { navigateTo } = useAppStore();
  const { isConnected, connectedDevices } = useWifiStore();
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);

  // Get device connection status
  const chestConnected = connectedDevices.some((d) => d.type === 'chest');
  const leftBandConnected = connectedDevices.some((d) => d.type === 'left_band');
  const rightBandConnected = connectedDevices.some((d) => d.type === 'right_band');

  // Saved places (mock data)
  const savedPlaces = [
    { id: '1', name: 'Home', icon: Home, category: 'home' },
    { id: '2', name: 'Office', icon: Briefcase, category: 'work' },
    { id: '3', name: 'Hospital', icon: Building2, category: 'medical' },
  ];

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col relative">
      {/* Map Background (simulated) */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-900">
        {/* Grid pattern to simulate map */}
        <div 
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(to right, #6366f1 1px, transparent 1px),
              linear-gradient(to bottom, #6366f1 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px'
          }}
        />
        
        {/* Center marker (user location) */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative">
            {/* Pulse effect */}
            <div className="absolute inset-0 w-12 h-12 rounded-full bg-blue-500/30 animate-ping" />
            <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/50">
              <MapPin className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* Top Bar - Device Status */}
      <div className="relative z-10 p-4">
        <div className="bg-gray-800/90 backdrop-blur-sm rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold text-white">Aura Guardian</h1>
            <button
              onClick={() => navigateTo('settings')}
              className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 transition-colors"
              aria-label="Settings"
            >
              <Settings className="w-5 h-5 text-gray-300" />
            </button>
          </div>
          
          {/* Device Status Row */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigateTo('deviceManager')}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors flex-1"
              aria-label="Device status. Tap to manage devices"
            >
              <Wifi className={`w-4 h-4 ${isConnected ? 'text-blue-400' : 'text-gray-500'}`} />
              <span className="text-sm text-gray-300">
                {connectedDevices.length}/3 devices
              </span>
            </button>
            
            {/* Individual device indicators */}
            <div className="flex gap-1">
              <div 
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  chestConnected ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'
                }`}
                title="Chest unit"
              >
                <span className="text-xs font-bold">C</span>
              </div>
              <div 
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  leftBandConnected ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'
                }`}
                title="Left wrist band"
              >
                <span className="text-xs font-bold">L</span>
              </div>
              <div 
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  rightBandConnected ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-500'
                }`}
                title="Right wrist band"
              >
                <span className="text-xs font-bold">R</span>
              </div>
            </div>
          </div>

          {/* Connection warning */}
          {!isConnected && (
            <div className="mt-3 flex items-center gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <WifiOff className="w-4 h-4 text-yellow-500" />
              <span className="text-sm text-yellow-400">
                Connect devices to start navigation
              </span>
            </div>
          )}
        </div>
      </div>

      {/* SOS Button - Floating */}
      <button
        className="absolute right-4 top-32 z-20 w-16 h-16 rounded-full bg-red-600 hover:bg-red-500 active:bg-red-700 flex items-center justify-center shadow-lg shadow-red-600/50 transition-all hover:scale-105 active:scale-95"
        aria-label="Emergency SOS. Press and hold for 3 seconds"
      >
        <span className="text-white font-bold text-lg">SOS</span>
        {/* Pulse animation */}
        <div className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30" />
      </button>

      {/* Bottom Sheet */}
      <div 
        className={`absolute bottom-0 left-0 right-0 z-10 bg-gray-800/95 backdrop-blur-sm rounded-t-3xl shadow-2xl transition-all duration-300 ${
          isBottomSheetExpanded ? 'h-[70%]' : 'h-auto'
        }`}
      >
        {/* Handle */}
        <button
          onClick={() => setIsBottomSheetExpanded(!isBottomSheetExpanded)}
          className="w-full py-3 flex justify-center"
          aria-label={isBottomSheetExpanded ? 'Collapse menu' : 'Expand menu'}
        >
          <div className="w-12 h-1.5 rounded-full bg-gray-600" />
        </button>

        <div className="px-6 pb-8">
          {/* Main Action Buttons */}
          <div className="space-y-3 mb-6">
            {/* Start Walk Button */}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => {
                // TODO: Start walk navigation
                console.log('Start Walk');
              }}
              disabled={!isConnected}
              className="h-16 text-xl font-bold"
              aria-label="Start Walk. Begin guided navigation"
            >
              <Play className="w-6 h-6 mr-3" />
              Start Walk
            </Button>

            {/* Secondary buttons row */}
            <div className="flex gap-3">
              <Button
                variant="secondary"
                size="md"
                fullWidth
                onClick={() => navigateTo('sensorLiveView')}
                className="h-14"
                aria-label="What's Ahead. Get current sensor readings"
              >
                <Eye className="w-5 h-5 mr-2" />
                What's Ahead
              </Button>
              
              <Button
                variant="secondary"
                size="md"
                fullWidth
                onClick={() => navigateTo('deviceDashboard')}
                className="h-14"
                aria-label="Device Dashboard. View all device status"
              >
                <Battery className="w-5 h-5 mr-2" />
                Devices
              </Button>
            </div>
          </div>

          {/* Saved Places */}
          <div>
            <h2 className="text-sm font-medium text-gray-400 mb-3">
              SAVED PLACES
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {savedPlaces.map((place) => (
                <button
                  key={place.id}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-700/50 hover:bg-gray-700 transition-colors min-w-[80px]"
                  aria-label={`Navigate to ${place.name}`}
                >
                  <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <place.icon className="w-6 h-6 text-purple-400" />
                  </div>
                  <span className="text-sm text-gray-300">{place.name}</span>
                </button>
              ))}
              
              {/* Add new place */}
              <button
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-700/30 border-2 border-dashed border-gray-600 hover:border-gray-500 transition-colors min-w-[80px]"
                aria-label="Add new saved place"
              >
                <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center">
                  <span className="text-2xl text-gray-400">+</span>
                </div>
                <span className="text-sm text-gray-500">Add</span>
              </button>
            </div>
          </div>

          {/* Emergency Contact Quick Dial - Expanded view */}
          {isBottomSheetExpanded && (
            <div className="mt-6 pt-6 border-t border-gray-700">
              <h2 className="text-sm font-medium text-gray-400 mb-3">
                QUICK CONTACT
              </h2>
              <button
                className="w-full flex items-center gap-4 p-4 rounded-xl bg-gray-700/50 hover:bg-gray-700 transition-colors"
                aria-label="Call emergency contact"
              >
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Phone className="w-6 h-6 text-green-400" />
                </div>
                <div className="text-left">
                  <p className="text-white font-medium">Emergency Contact</p>
                  <p className="text-sm text-gray-400">Tap to call guardian</p>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

