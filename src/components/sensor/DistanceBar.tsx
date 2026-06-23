import { cn } from '../../utils/cn';
import { getDistanceZone, getZoneColor, formatDistance } from '../../models/SensorData';

interface DistanceBarProps {
  distance: number;
  label: string;
  maxDistance?: number;
  showValue?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function DistanceBar({
  distance,
  label,
  maxDistance = 300,
  showValue = true,
  size = 'md',
  className,
}: DistanceBarProps) {
  const zone = getDistanceZone(distance);
  const color = getZoneColor(zone);
  const percentage = Math.min(100, (distance / maxDistance) * 100);

  // Size configuration
  const sizeConfig = {
    sm: { height: 'h-2', text: 'text-xs', labelText: 'text-xs' },
    md: { height: 'h-3', text: 'text-sm', labelText: 'text-sm' },
    lg: { height: 'h-4', text: 'text-base', labelText: 'text-base' },
  };

  const config = sizeConfig[size];

  return (
    <div className={cn('w-full', className)}>
      {/* Label and Value */}
      <div className="flex items-center justify-between mb-1">
        <span className={cn('text-gray-400', config.labelText)}>{label}</span>
        {showValue && (
          <span className={cn('font-medium', config.text)} style={{ color }}>
            {formatDistance(distance)}
          </span>
        )}
      </div>

      {/* Progress Bar */}
      <div className={cn('w-full bg-gray-700 rounded-full overflow-hidden', config.height)}>
        <div
          className="h-full transition-all duration-200 ease-out rounded-full"
          style={{
            width: `${percentage}%`,
            backgroundColor: color,
          }}
        />
      </div>

      {/* Zone indicator */}
      <div className="flex items-center gap-1 mt-1">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs text-gray-500 capitalize">{zone}</span>
      </div>
    </div>
  );
}
