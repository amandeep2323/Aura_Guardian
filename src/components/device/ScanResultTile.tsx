import { Cpu, Watch, Wifi, Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { ScanResult, DeviceType } from '../../models/Device';
import SignalStrengthBar from './SignalStrengthBar';

interface ScanResultTileProps {
  device: ScanResult;
  isConnecting?: boolean;
  onConnect?: () => void;
  className?: string;
}

// Get device type from name
function getDeviceTypeFromName(name: string): DeviceType {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('chest') || lowerName.includes('main')) return 'chest';
  if (lowerName.includes('left')) return 'left_band';
  if (lowerName.includes('right')) return 'right_band';
  return 'chest';
}

// Get icon for device type
function getDeviceIcon(type: DeviceType) {
  switch (type) {
    case 'chest':
      return Cpu;
    case 'left_band':
    case 'right_band':
      return Watch;
    default:
      return Wifi;
  }
}

export default function ScanResultTile({
  device,
  isConnecting = false,
  onConnect,
  className,
}: ScanResultTileProps) {
  const deviceType = getDeviceTypeFromName(device.name);
  const Icon = getDeviceIcon(deviceType);

  return (
    <button
      onClick={onConnect}
      disabled={isConnecting}
      className={cn(
        'w-full p-4 rounded-xl bg-gray-800 border border-gray-700 text-left',
        'hover:border-blue-500/50 transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
      aria-label={`Connect to ${device.name}`}
    >
      <div className="flex items-center gap-4">
        {/* Device Icon */}
        <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
          {isConnecting ? (
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          ) : (
            <Icon className="w-6 h-6 text-blue-400" />
          )}
        </div>

        {/* Device Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-white truncate">{device.name}</h3>
          <p className="text-sm text-gray-400">
            {isConnecting ? 'Connecting...' : 'Tap to connect'}
          </p>
        </div>

        {/* Signal Strength */}
        <SignalStrengthBar rssi={device.rssi} size="sm" />
      </div>

      {/* Service endpoints (if available) */}
      {device.serviceEndpoints && device.serviceEndpoints.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {device.serviceEndpoints.slice(0, 2).map((endpoint, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-400 truncate max-w-[120px]"
            >
              {endpoint}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
