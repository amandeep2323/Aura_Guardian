/**
 * Aura Guardian - Haptic Patterns
 * Defines all 10 haptic feedback patterns and intensity levels
 */

export interface HapticPattern {
  id: number;
  name: string;
  leftWrist: string;
  rightWrist: string;
  meaning: string;
  description: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export const HAPTIC_PATTERNS: HapticPattern[] = [
  {
    id: 0x00,
    name: 'Clear Path',
    leftWrist: 'Off',
    rightWrist: 'Off',
    meaning: 'Clear path — safe',
    description: 'No obstacles detected. Path is clear to proceed.',
    urgency: 'low',
  },
  {
    id: 0x01,
    name: 'Obstacle Left',
    leftWrist: '2 short pulses',
    rightWrist: '—',
    meaning: 'Obstacle LEFT → go RIGHT',
    description: 'Obstacle detected on your left side. Move to the right.',
    urgency: 'medium',
  },
  {
    id: 0x02,
    name: 'Obstacle Right',
    leftWrist: '—',
    rightWrist: '2 short pulses',
    meaning: 'Obstacle RIGHT → go LEFT',
    description: 'Obstacle detected on your right side. Move to the left.',
    urgency: 'medium',
  },
  {
    id: 0x03,
    name: 'Obstacle Ahead',
    leftWrist: '1 long pulse',
    rightWrist: '1 long pulse',
    meaning: 'Obstacle AHEAD → STOP',
    description: 'Obstacle directly ahead. Stop and assess the situation.',
    urgency: 'high',
  },
  {
    id: 0x04,
    name: 'Danger',
    leftWrist: 'Rapid vibration',
    rightWrist: 'Rapid vibration',
    meaning: 'DANGER <30cm → URGENT',
    description: 'Very close obstacle! Immediate attention required.',
    urgency: 'critical',
  },
  {
    id: 0x05,
    name: 'Drop Left',
    leftWrist: '3 short pulses',
    rightWrist: '—',
    meaning: 'Pothole/drop LEFT',
    description: 'Pothole or drop detected on your left. Avoid that area.',
    urgency: 'high',
  },
  {
    id: 0x06,
    name: 'Drop Right',
    leftWrist: '—',
    rightWrist: '3 short pulses',
    meaning: 'Pothole/drop RIGHT',
    description: 'Pothole or drop detected on your right. Avoid that area.',
    urgency: 'high',
  },
  {
    id: 0x07,
    name: 'Low Battery',
    leftWrist: 'Heartbeat rhythm',
    rightWrist: 'Heartbeat rhythm',
    meaning: 'Low battery warning',
    description: 'Device battery is running low. Consider charging soon.',
    urgency: 'low',
  },
  {
    id: 0x08,
    name: 'Shift Left',
    leftWrist: 'Gentle rhythmic',
    rightWrist: '—',
    meaning: 'Guidance: shift LEFT',
    description: 'Gently shift towards the left for better path.',
    urgency: 'low',
  },
  {
    id: 0x09,
    name: 'Shift Right',
    leftWrist: '—',
    rightWrist: 'Gentle rhythmic',
    meaning: 'Guidance: shift RIGHT',
    description: 'Gently shift towards the right for better path.',
    urgency: 'low',
  },
];

/**
 * Intensity levels based on distance
 */
export interface IntensityLevel {
  byte: number;
  name: string;
  minDistance: number;
  maxDistance: number;
  feel: string;
}

export const INTENSITY_LEVELS: IntensityLevel[] = [
  { byte: 0x00, name: 'None', minDistance: 300, maxDistance: Infinity, feel: 'Clear' },
  { byte: 0x01, name: 'Soft', minDistance: 200, maxDistance: 300, feel: 'Gentle vibration' },
  { byte: 0x02, name: 'Medium', minDistance: 100, maxDistance: 200, feel: 'Noticeable vibration' },
  { byte: 0x03, name: 'Strong', minDistance: 30, maxDistance: 100, feel: 'Strong vibration' },
  { byte: 0x04, name: 'Urgent', minDistance: 0, maxDistance: 30, feel: 'Rapid SOS pattern' },
];

/**
 * Get intensity level based on distance in cm
 */
export function getIntensityForDistance(distanceCm: number): IntensityLevel {
  for (const level of INTENSITY_LEVELS) {
    if (distanceCm >= level.minDistance && distanceCm < level.maxDistance) {
      return level;
    }
  }
  return INTENSITY_LEVELS[INTENSITY_LEVELS.length - 1];
}

/**
 * Get haptic pattern by ID
 */
export function getHapticPatternById(id: number): HapticPattern | undefined {
  return HAPTIC_PATTERNS.find(p => p.id === id);
}
