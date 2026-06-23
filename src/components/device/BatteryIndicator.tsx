import { BatteryLow, BatteryMedium, BatteryFull, BatteryWarning } from 'lucide-react';
import { cn } from '../../utils/cn';

interface BatteryIndicatorProps {
  percent: number;
  size?: 'sm' | 'md' | 'lg';
  showPercentage?: boolean;
  className?: string;
}

export default function BatteryIndicator({
  percent,
  size = 'md',
  showPercentage = true,
  className,
}: BatteryIndicatorProps) {
  // Get battery icon based on level
  const getBatteryIcon = () => {
    if (percent <= 10) return BatteryWarning;
    if (percent <= 25) return BatteryLow;
    if (percent <= 75) return BatteryMedium;
    return BatteryFull;
  };

  // Get color based on level
  const getColor = () => {
    if (percent <= 10) return 'text-red-500';
    if (percent <= 25) return 'text-orange-500';
    if (percent <= 50) return 'text-yellow-500';
    return 'text-green-500';
  };

  // Size classes
  const sizeClasses = {
    sm: { icon: 'w-4 h-4', text: 'text-xs' },
    md: { icon: 'w-5 h-5', text: 'text-sm' },
    lg: { icon: 'w-6 h-6', text: 'text-base' },
  };

  const Icon = getBatteryIcon();

  return (
    <div
      className={cn(
        'flex items-center gap-1',
        getColor(),
        className
      )}
      role="status"
      aria-label={`Battery at ${percent} percent`}
    >
      <Icon className={sizeClasses[size].icon} />
      {showPercentage && (
        <span className={cn('font-medium', sizeClasses[size].text)}>
          {percent}%
        </span>
      )}
    </div>
  );
}
