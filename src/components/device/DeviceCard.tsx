import { Cpu, Watch, Headphones, Smartphone } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { Device, DeviceType } from '../../models/Device';
import BatteryIndicator from './BatteryIndicator';
import SignalStrengthBar from './SignalStrengthBar';

interface DeviceCardProps {
  device: Device;
  onDisconnect?: () => void;
  className?: string;
}

// Get icon for device type
function getDeviceIcon(type: DeviceType) {
  switch (type) {
    case 'chest':
      return Cpu;
    case 'left_band':
    case 'right_band':
      return Watch;
    case 'headphones':
      return Headphones;
    default:
      return Smartphone;
  }
}

// Get device type display name
function getDeviceTypeName(type: DeviceType): string {
  switch (type) {
    case 'chest': return 'Chest Unit';
    case 'left_band': return 'Left Wrist Band';
    case 'right_band': return 'Right Wrist Band';
    case 'headphones': return 'Headphones';
    default: return 'Unknown Device';
  }
}

export default function DeviceCard({ device, onDisconnect, className }: DeviceCardProps) {
  const Icon = getDeviceIcon(device.type);
  const isConnected = device.status === 'connected';

  return (
    <div
      className={cn(
        'p-4 rounded-xl transition-all',
        isConnected ? 'bg-gray-800 border border-green-500/30' : 'bg-gray-800/50 border border-gray-700',
        className
      )}
    >
      <div className="flex items-center gap-4">
        {/* Device Icon */}
        <div className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center',
          isConnected ? 'bg-green-500/20' : 'bg-gray-700'
        )}>
          <Icon className={cn('w-6 h-6', isConnected ? 'text-green-400' : 'text-gray-500')} />
        </div>

        {/* Device Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-white truncate">{device.name}</h3>
          <p className="text-sm text-gray-400">{getDeviceTypeName(device.type)}</p>
        </div>

        {/* Status Indicators */}
        {isConnected && (
          <div className="flex items-center gap-3">
            <BatteryIndicator percent={device.battery} size="sm" />
            <SignalStrengthBar rssi={device.rssi} size="sm" />
          </div>
        )}
      </div>

      {/* Disconnect Button */}
      {isConnected && onDisconnect && (
        <button
          onClick={onDisconnect}
          className="mt-3 w-full py-2 px-4 rounded-lg bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-colors"
        >
          Disconnect
        </button>
      )}
    </div>
  );
}
