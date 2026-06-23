/**
 * Aura Guardian - Connection Status Badge
 * Shows device connection status with color coding
 */

import React from 'react';
import { 
  Wifi,
  WifiOff,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { CONNECTION_STATES, type ConnectionState } from '../../config/constants';

interface ConnectionStatusBadgeProps {
  state: ConnectionState;
  deviceName?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const ConnectionStatusBadge: React.FC<ConnectionStatusBadgeProps> = ({
  state,
  deviceName,
  showLabel = true,
  size = 'md',
  className,
}) => {
  const getStatusConfig = () => {
    switch (state) {
      case CONNECTION_STATES.CONNECTED:
        return {
          icon: Wifi,
          label: 'Connected',
          color: 'text-green-500',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/30',
          pulseColor: 'bg-green-500',
        };
      case CONNECTION_STATES.CONNECTING:
      case CONNECTION_STATES.RECONNECTING:
        return {
          icon: Loader2,
          label: state === CONNECTION_STATES.CONNECTING ? 'Connecting...' : 'Reconnecting...',
          color: 'text-yellow-500',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30',
          pulseColor: 'bg-yellow-500',
        };
      case CONNECTION_STATES.SCANNING:
        return {
          icon: Wifi,
          label: 'Discovering...',
          color: 'text-blue-500',
          bgColor: 'bg-blue-500/10',
          borderColor: 'border-blue-500/30',
          pulseColor: 'bg-blue-500',
        };
      case CONNECTION_STATES.ERROR:
        return {
          icon: AlertCircle,
          label: 'Error',
          color: 'text-red-500',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30',
          pulseColor: 'bg-red-500',
        };
      case CONNECTION_STATES.DISCONNECTED:
      default:
        return {
          icon: WifiOff,
          label: 'Disconnected',
          color: 'text-gray-500',
          bgColor: 'bg-gray-500/10',
          borderColor: 'border-gray-500/30',
          pulseColor: 'bg-gray-500',
        };
    }
  };
  
  const config = getStatusConfig();
  const Icon = config.icon;
  
  const sizeStyles = {
    sm: {
      container: 'px-2 py-1',
      icon: 'w-3 h-3',
      text: 'text-xs',
      pulse: 'w-1.5 h-1.5',
    },
    md: {
      container: 'px-3 py-1.5',
      icon: 'w-4 h-4',
      text: 'text-sm',
      pulse: 'w-2 h-2',
    },
    lg: {
      container: 'px-4 py-2',
      icon: 'w-5 h-5',
      text: 'text-base',
      pulse: 'w-2.5 h-2.5',
    },
  };
  
  const animatingStates: string[] = [
    CONNECTION_STATES.CONNECTING, 
    CONNECTION_STATES.RECONNECTING, 
    CONNECTION_STATES.SCANNING
  ];
  const isAnimating = animatingStates.includes(state);
  
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border',
        config.bgColor,
        config.borderColor,
        sizeStyles[size].container,
        className
      )}
      role="status"
      aria-label={`${deviceName ? deviceName + ': ' : ''}${config.label}`}
    >
      {/* Pulsing indicator */}
      <span className="relative flex">
        <span 
          className={cn(
            'rounded-full',
            config.pulseColor,
            sizeStyles[size].pulse,
            isAnimating && 'animate-ping absolute inline-flex h-full w-full opacity-75'
          )}
        />
        <span 
          className={cn(
            'relative inline-flex rounded-full',
            config.pulseColor,
            sizeStyles[size].pulse
          )}
        />
      </span>
      
      {/* Icon */}
      <Icon 
        className={cn(
          config.color, 
          sizeStyles[size].icon,
          isAnimating && 'animate-pulse'
        )} 
      />
      
      {/* Label */}
      {showLabel && (
        <span className={cn(config.color, sizeStyles[size].text, 'font-medium')}>
          {deviceName ? `${deviceName}` : config.label}
        </span>
      )}
    </div>
  );
};

export default ConnectionStatusBadge;
