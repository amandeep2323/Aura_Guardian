/**
 * Aura Guardian - Loading Spinner
 * Accessible loading indicator with optional message
 */

import React from 'react';
import { cn } from '../../utils/cn';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  message?: string;
  className?: string;
  fullScreen?: boolean;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  message,
  className,
  fullScreen = false,
}) => {
  const sizeStyles = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24',
  };
  
  const textSizeStyles = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
    xl: 'text-xl',
  };
  
  const spinner = (
    <div 
      className={cn('flex flex-col items-center justify-center gap-4', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className={cn('relative', sizeStyles[size])}>
        {/* Outer ring */}
        <div 
          className={cn(
            'absolute inset-0 rounded-full border-4 border-gray-700',
            sizeStyles[size]
          )} 
        />
        {/* Spinning arc */}
        <div 
          className={cn(
            'absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin',
            sizeStyles[size]
          )} 
        />
        {/* Inner glow */}
        <div 
          className={cn(
            'absolute inset-2 rounded-full bg-indigo-500/10 animate-pulse'
          )} 
        />
      </div>
      
      {message && (
        <p className={cn('text-gray-400 animate-pulse', textSizeStyles[size])}>
          {message}
        </p>
      )}
      
      {/* Screen reader text */}
      <span className="sr-only">
        {message || 'Loading...'}
      </span>
    </div>
  );
  
  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
        {spinner}
      </div>
    );
  }
  
  return spinner;
};

export default LoadingSpinner;
