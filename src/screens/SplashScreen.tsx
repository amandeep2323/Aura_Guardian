import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { APP_CONFIG } from '../config/app';
import { Shield, Waves } from 'lucide-react';

export default function SplashScreen() {
  const { navigateTo } = useAppStore();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Initializing...');

  useEffect(() => {
    // Simulate initialization steps
    const steps = [
      { progress: 20, status: 'Loading configuration...', delay: 500 },
      { progress: 40, status: 'Checking permissions...', delay: 800 },
      { progress: 60, status: 'Initializing Wi-Fi...', delay: 600 },
      { progress: 80, status: 'Setting up services...', delay: 500 },
      { progress: 100, status: 'Ready!', delay: 400 },
    ];

    let currentStep = 0;
    
    const runStep = () => {
      if (currentStep < steps.length) {
        const step = steps[currentStep];
        setProgress(step.progress);
        setStatus(step.status);
        currentStep++;
        
        if (currentStep < steps.length) {
          setTimeout(runStep, step.delay);
        } else {
          // Navigate to home after completion
          setTimeout(() => {
            navigateTo('userHome');
          }, 800);
        }
      }
    };

    // Start after a brief delay
    setTimeout(runStep, 500);
  }, [navigateTo]);

  return (
    <div 
      className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-8"
      role="main"
      aria-label="Aura Guardian loading screen"
    >
      {/* Logo Animation */}
      <div className="relative mb-8">
        {/* Outer pulsing ring */}
        <div className="absolute inset-0 animate-ping">
          <div className="w-32 h-32 rounded-full bg-purple-500/20" />
        </div>
        
        {/* Inner glow */}
        <div className="absolute inset-0 animate-pulse">
          <div className="w-32 h-32 rounded-full bg-gradient-to-br from-purple-500/40 to-blue-500/40 blur-xl" />
        </div>
        
        {/* Logo container */}
        <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-2xl shadow-purple-500/50">
          <Shield className="w-16 h-16 text-white" strokeWidth={1.5} />
          <Waves className="w-8 h-8 text-white/80 absolute bottom-4" strokeWidth={1.5} />
        </div>
      </div>

      {/* App Name */}
      <h1 className="text-4xl font-bold text-white mb-2 tracking-wide">
        {APP_CONFIG.name}
      </h1>
      
      {/* Tagline */}
      <p className="text-purple-300 text-lg mb-12">
        {APP_CONFIG.tagline}
      </p>

      {/* Progress Bar */}
      <div className="w-64 h-2 bg-gray-800 rounded-full overflow-hidden mb-4">
        <div 
          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Loading progress"
        />
      </div>

      {/* Status Text */}
      <p className="text-gray-400 text-sm" aria-live="polite">
        {status}
      </p>

      {/* Version */}
      <p className="absolute bottom-8 text-gray-600 text-xs">
        Version {APP_CONFIG.version}
      </p>
    </div>
  );
}
