import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useWifiStore } from '../stores/wifiStore';
import { 
  ArrowLeft, 
  ArrowUp,
  ArrowDown,
  ArrowLeftIcon,
  ArrowRightIcon,
  Activity,
  Footprints
} from 'lucide-react';
import { getDistanceZone, getZoneColor, getZoneBgColor, formatDistance } from '../models/SensorData';

export default function SensorLiveViewScreen() {
  const { goBack } = useAppStore();
  const { sensorData, sensorHistory } = useWifiStore();
  const [animationPhase, setAnimationPhase] = useState(0);

  // Animate sensor visualization
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationPhase(prev => (prev + 1) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Get zone for each sensor
  const leftZone = getDistanceZone(sensorData.leftDistance);
  const centerZone = getDistanceZone(sensorData.centerDistance);
  const rightZone = getDistanceZone(sensorData.rightDistance);

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
        <div className="flex items-center gap-4 p-4">
          <button
            onClick={goBack}
            className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Live Sensor View</h1>
            <p className="text-sm text-gray-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Real-time data at 10Hz ({sensorHistory.length} samples)
            </p>
          </div>
          <Activity className="w-6 h-6 text-purple-400" />
        </div>
      </header>

      <main className="flex-1 p-4 space-y-6 overflow-auto">
        {/* Visual Radar Display */}
        <div className="relative aspect-square max-w-md mx-auto">
          {/* Background circles */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 400">
            {/* Radar rings */}
            {[0.25, 0.5, 0.75, 1].map((r, i) => (
              <circle
                key={i}
                cx="200"
                cy="200"
                r={180 * r}
                fill="none"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="1"
              />
            ))}
            
            {/* Direction lines */}
            <line x1="200" y1="20" x2="200" y2="380" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <line x1="20" y1="200" x2="380" y2="200" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            
            {/* Scanning beam animation */}
            <line
              x1="200"
              y1="200"
              x2={200 + 180 * Math.cos((animationPhase * Math.PI) / 180)}
              y2={200 + 180 * Math.sin((animationPhase * Math.PI) / 180)}
              stroke="rgba(168, 85, 247, 0.3)"
              strokeWidth="2"
            />
            
            {/* Center point (user position) */}
            <circle cx="200" cy="200" r="15" fill="#6366f1" />
            <circle cx="200" cy="200" r="8" fill="#a855f7" />
            
            {/* Left sensor beam (-30°) */}
            <g transform="rotate(-30, 200, 200)">
              <path
                d={`M 200 200 L ${200 - 30} ${200 - Math.min(sensorData.leftDistance / 2, 180)} L ${200 + 30} ${200 - Math.min(sensorData.leftDistance / 2, 180)} Z`}
                fill={getZoneBgColor(leftZone)}
                stroke={getZoneColor(leftZone)}
                strokeWidth="2"
              />
            </g>
            
            {/* Center sensor beam (0°) */}
            <g>
              <path
                d={`M 200 200 L ${200 - 25} ${200 - Math.min(sensorData.centerDistance / 2, 180)} L ${200 + 25} ${200 - Math.min(sensorData.centerDistance / 2, 180)} Z`}
                fill={getZoneBgColor(centerZone)}
                stroke={getZoneColor(centerZone)}
                strokeWidth="2"
              />
            </g>
            
            {/* Right sensor beam (+30°) */}
            <g transform="rotate(30, 200, 200)">
              <path
                d={`M 200 200 L ${200 - 30} ${200 - Math.min(sensorData.rightDistance / 2, 180)} L ${200 + 30} ${200 - Math.min(sensorData.rightDistance / 2, 180)} Z`}
                fill={getZoneBgColor(rightZone)}
                stroke={getZoneColor(rightZone)}
                strokeWidth="2"
              />
            </g>
            
            {/* Distance labels */}
            <text x="200" y="80" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="12">2m</text>
            <text x="200" y="125" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="12">1.5m</text>
            <text x="200" y="170" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="12">1m</text>
          </svg>
          
          {/* Direction indicators */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-gray-800/80">
            <ArrowUp className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">FRONT</span>
          </div>
        </div>

        {/* Distance Cards */}
        <div className="grid grid-cols-3 gap-3">
          {/* Left */}
          <div 
            className="p-4 rounded-xl text-center transition-colors"
            style={{ 
              backgroundColor: getZoneBgColor(leftZone),
              borderColor: getZoneColor(leftZone),
              borderWidth: 2
            }}
          >
            <div className="flex items-center justify-center gap-1 mb-2">
              <ArrowLeftIcon className="w-4 h-4" style={{ color: getZoneColor(leftZone) }} />
              <span className="text-sm font-medium" style={{ color: getZoneColor(leftZone) }}>
                Left
              </span>
            </div>
            <p className="text-2xl font-bold text-white">
              {formatDistance(sensorData.leftDistance)}
            </p>
          </div>

          {/* Center */}
          <div 
            className="p-4 rounded-xl text-center transition-colors"
            style={{ 
              backgroundColor: getZoneBgColor(centerZone),
              borderColor: getZoneColor(centerZone),
              borderWidth: 2
            }}
          >
            <div className="flex items-center justify-center gap-1 mb-2">
              <ArrowUp className="w-4 h-4" style={{ color: getZoneColor(centerZone) }} />
              <span className="text-sm font-medium" style={{ color: getZoneColor(centerZone) }}>
                Center
              </span>
            </div>
            <p className="text-2xl font-bold text-white">
              {formatDistance(sensorData.centerDistance)}
            </p>
          </div>

          {/* Right */}
          <div 
            className="p-4 rounded-xl text-center transition-colors"
            style={{ 
              backgroundColor: getZoneBgColor(rightZone),
              borderColor: getZoneColor(rightZone),
              borderWidth: 2
            }}
          >
            <div className="flex items-center justify-center gap-1 mb-2">
              <ArrowRightIcon className="w-4 h-4" style={{ color: getZoneColor(rightZone) }} />
              <span className="text-sm font-medium" style={{ color: getZoneColor(rightZone) }}>
                Right
              </span>
            </div>
            <p className="text-2xl font-bold text-white">
              {formatDistance(sensorData.rightDistance)}
            </p>
          </div>
        </div>

        {/* Ground & Far Distance */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-xl bg-gray-800">
            <div className="flex items-center gap-2 mb-2">
              <ArrowDown className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-gray-400">Ground</span>
            </div>
            <p className="text-2xl font-bold text-white">{sensorData.groundDistance}cm</p>
            <p className="text-xs text-gray-500 mt-1">
              {sensorData.groundDistance < 20 ? '⚠️ Possible drop' : 'Normal'}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-gray-800">
            <div className="flex items-center gap-2 mb-2">
              <ArrowUp className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-gray-400">Far (ToF)</span>
            </div>
            <p className="text-2xl font-bold text-white">{(sensorData.farDistance / 100).toFixed(1)}m</p>
            <p className="text-xs text-gray-500 mt-1">
              Up to 4m range
            </p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="p-4 rounded-xl bg-gray-800">
          <h3 className="text-sm font-medium text-gray-400 mb-3">STATUS INDICATORS</h3>
          <div className="flex flex-wrap gap-2">
            <span className={`px-3 py-2 rounded-lg text-sm font-medium ${
              sensorData.stairsDetected 
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                : 'bg-gray-700 text-gray-500'
            }`}>
              🪜 Stairs: {sensorData.stairsDetected ? 'Detected' : 'None'}
            </span>
            
            <span className={`px-3 py-2 rounded-lg text-sm font-medium ${
              sensorData.roughSurface 
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' 
                : 'bg-gray-700 text-gray-500'
            }`}>
              🔴 Surface: {sensorData.roughSurface ? 'Rough' : 'Smooth'}
            </span>
            
            <span className={`px-3 py-2 rounded-lg text-sm font-medium ${
              sensorData.fallDetected 
                ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' 
                : 'bg-gray-700 text-gray-500'
            }`}>
              ⚠️ Fall: {sensorData.fallDetected ? 'DETECTED!' : 'None'}
            </span>
          </div>
        </div>

        {/* Steps & Battery */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-xl bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Footprints className="w-5 h-5 text-purple-400" />
              <span className="text-sm text-gray-400">Steps</span>
            </div>
            <p className="text-3xl font-bold text-white">{sensorData.stepCount}</p>
          </div>

          <div className="p-4 rounded-xl bg-gradient-to-br from-green-600/20 to-emerald-600/20 border border-green-500/20">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🔋</span>
              <span className="text-sm text-gray-400">Battery</span>
            </div>
            <p className="text-3xl font-bold text-white">{sensorData.batteryPercent}%</p>
          </div>
        </div>

        {/* Legend */}
        <div className="p-4 rounded-xl bg-gray-800/50">
          <h3 className="text-sm font-medium text-gray-400 mb-3">DISTANCE ZONES</h3>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-sm text-gray-400">{'>'}2m Clear</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-sm text-gray-400">1-2m Caution</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-sm text-gray-400">30cm-1m Warning</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-sm text-gray-400">{'<'}30cm Danger</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

