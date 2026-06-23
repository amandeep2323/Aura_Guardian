import { cn } from '../../utils/cn';

interface SignalStrengthBarProps {
  rssi: number;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
  className?: string;
}

// Get number of signal bars from RSSI
function getSignalBars(rssi: number): number {
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  if (rssi >= -80) return 1;
  return 0;
}

// Get signal strength level from RSSI
function getSignalStrengthLevel(rssi: number): 'excellent' | 'good' | 'fair' | 'weak' | 'none' {
  if (rssi >= -50) return 'excellent';
  if (rssi >= -60) return 'good';
  if (rssi >= -70) return 'fair';
  if (rssi >= -80) return 'weak';
  return 'none';
}

export default function SignalStrengthBar({
  rssi,
  size = 'md',
  showValue = false,
  className,
}: SignalStrengthBarProps) {
  const bars = getSignalBars(rssi);
  const level = getSignalStrengthLevel(rssi);

  // Size configuration
  const sizeConfig = {
    sm: { bar: 'w-1', heights: ['h-1', 'h-2', 'h-3', 'h-4'], gap: 'gap-0.5' },
    md: { bar: 'w-1.5', heights: ['h-1.5', 'h-3', 'h-4', 'h-5'], gap: 'gap-0.5' },
    lg: { bar: 'w-2', heights: ['h-2', 'h-4', 'h-5', 'h-6'], gap: 'gap-1' },
  };

  // Color based on signal strength
  const getBarColor = (barIndex: number) => {
    if (barIndex >= bars) return 'bg-gray-600';
    
    switch (level) {
      case 'excellent': return 'bg-green-500';
      case 'good': return 'bg-green-400';
      case 'fair': return 'bg-yellow-500';
      case 'weak': return 'bg-orange-500';
      case 'none': return 'bg-red-500';
    }
  };

  const config = sizeConfig[size];

  return (
    <div
      className={cn('flex items-end', config.gap, className)}
      role="status"
      aria-label={`Signal strength: ${level}, ${rssi} dBm`}
    >
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className={cn(
            config.bar,
            config.heights[index],
            'rounded-sm transition-colors',
            getBarColor(index)
          )}
        />
      ))}
      {showValue && (
        <span className="ml-1 text-xs text-gray-400">
          {rssi}dBm
        </span>
      )}
    </div>
  );
}
