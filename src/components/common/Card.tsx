/**
 * Aura Guardian - Accessible Card Component
 * Wrapper component for content sections
 */

import React from 'react';
import { cn } from '../../utils/cn';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  variant?: 'default' | 'elevated' | 'outlined';
  onClick?: () => void;
  accessibilityLabel?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  padding = 'md',
  variant = 'default',
  onClick,
  accessibilityLabel,
}) => {
  const baseStyles = 'rounded-2xl transition-all duration-200';
  
  const variantStyles = {
    default: 'bg-gray-900 border border-gray-800',
    elevated: 'bg-gray-900 shadow-xl shadow-black/20',
    outlined: 'bg-transparent border-2 border-gray-700',
  };
  
  const paddingStyles = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  };
  
  const interactiveStyles = onClick 
    ? 'cursor-pointer hover:bg-gray-800 hover:border-gray-700 active:scale-[0.98]' 
    : '';
  
  const Component = onClick ? 'button' : 'div';
  
  return (
    <Component
      className={cn(
        baseStyles,
        variantStyles[variant],
        paddingStyles[padding],
        interactiveStyles,
        className
      )}
      onClick={onClick}
      aria-label={accessibilityLabel}
      role={onClick ? 'button' : undefined}
    >
      {children}
    </Component>
  );
};

export const CardHeader: React.FC<{ 
  children: React.ReactNode; 
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('mb-4', className)}>
    {children}
  </div>
);

export const CardTitle: React.FC<{ 
  children: React.ReactNode; 
  className?: string;
}> = ({ children, className }) => (
  <h3 className={cn('text-lg font-semibold text-white', className)}>
    {children}
  </h3>
);

export const CardDescription: React.FC<{ 
  children: React.ReactNode; 
  className?: string;
}> = ({ children, className }) => (
  <p className={cn('text-sm text-gray-400 mt-1', className)}>
    {children}
  </p>
);

export const CardContent: React.FC<{ 
  children: React.ReactNode; 
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('', className)}>
    {children}
  </div>
);

export const CardFooter: React.FC<{ 
  children: React.ReactNode; 
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('mt-4 pt-4 border-t border-gray-800', className)}>
    {children}
  </div>
);

export default Card;
