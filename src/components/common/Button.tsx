/**
 * Aura Guardian - Accessible Button Component
 * Large touch targets (min 48dp, prefer 64dp) with semantic labels
 */

import React from 'react';
import { cn } from '../../utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  fullWidth?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  accessibilityLabel?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  icon,
  iconPosition = 'left',
  accessibilityLabel,
  className,
  disabled,
  ...props
}) => {
  const baseStyles = `
    inline-flex items-center justify-center
    font-semibold rounded-xl
    transition-all duration-200
    focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-900
    disabled:opacity-50 disabled:cursor-not-allowed
    select-none
  `;
  
  const variantStyles = {
    primary: `
      bg-indigo-600 text-white
      hover:bg-indigo-700 active:bg-indigo-800
      focus:ring-indigo-500
    `,
    secondary: `
      bg-gray-700 text-white
      hover:bg-gray-600 active:bg-gray-500
      focus:ring-gray-500
    `,
    danger: `
      bg-red-600 text-white
      hover:bg-red-700 active:bg-red-800
      focus:ring-red-500
    `,
    ghost: `
      bg-transparent text-gray-300
      hover:bg-gray-800 active:bg-gray-700
      focus:ring-gray-500
    `,
    outline: `
      bg-transparent text-indigo-400 border-2 border-indigo-500
      hover:bg-indigo-500/10 active:bg-indigo-500/20
      focus:ring-indigo-500
    `,
  };
  
  const sizeStyles = {
    sm: 'px-3 py-2 text-sm min-h-[36px]',
    md: 'px-4 py-3 text-base min-h-[48px]',
    lg: 'px-6 py-4 text-lg min-h-[56px]',
    xl: 'px-8 py-5 text-xl min-h-[64px]', // Preferred for primary actions
  };
  
  return (
    <button
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && 'w-full',
        className
      )}
      disabled={disabled || loading}
      aria-label={accessibilityLabel}
      aria-busy={loading}
      {...props}
    >
      {loading ? (
        <span className="animate-spin mr-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle 
              className="opacity-25" 
              cx="12" 
              cy="12" 
              r="10" 
              stroke="currentColor" 
              strokeWidth="4"
            />
            <path 
              className="opacity-75" 
              fill="currentColor" 
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </span>
      ) : (
        icon && iconPosition === 'left' && <span className="mr-2">{icon}</span>
      )}
      {children}
      {!loading && icon && iconPosition === 'right' && (
        <span className="ml-2">{icon}</span>
      )}
    </button>
  );
};

export default Button;
