/**
 * Aura Guardian - Route Configuration
 * Named route strings for navigation
 */

export const ROUTES = {
  // Auth & Onboarding
  splash: '/',
  login: '/login',
  register: '/register',
  profileSetup: '/profile-setup',
  welcomeTutorial: '/welcome',
  devicePairingGuide: '/device-pairing',
  hapticLearning: '/haptic-learning',
  calibrationWalk: '/calibration',
  
  // User Home
  userHome: '/home',
  quickStatus: '/quick-status',
  
  // Device Management
  deviceManager: '/devices',
  deviceDashboard: '/devices/dashboard',
  sensorLiveView: '/devices/sensors',
  deviceErrorLogs: '/devices/logs',
  
  // Navigation & Maps
  setDestination: '/navigate',
  routeSelection: '/navigate/routes',
  activeNavigation: '/navigate/active',
  savedLocations: '/locations',
  backtrack: '/backtrack',
  liveTripSharing: '/share-trip',
  
  // Trips & History
  tripHistory: '/trips',
  tripDetail: '/trips/:tripId',
  tripComparison: '/trips/compare',
  
  // Obstacles
  obstacleMap: '/obstacles',
  obstacleDetail: '/obstacles/:obstacleId',
  heatmap: '/obstacles/heatmap',
  
  // Analytics
  analytics: '/analytics',
  weeklyReport: '/analytics/weekly',
  routeRankings: '/analytics/rankings',
  
  // Guardian
  guardianHome: '/guardian',
  guardianUserDetail: '/guardian/user/:userId',
  guardianAlertHistory: '/guardian/alerts',
  geofenceSetup: '/guardian/geofence',
  guardianTripHistory: '/guardian/trips',
  guardianWeeklyReport: '/guardian/report',
  
  // SOS
  sosActive: '/sos',
  sosHistory: '/sos/history',
  
  // Settings
  settings: '/settings',
  hapticSettings: '/settings/haptic',
  voiceSettings: '/settings/voice',
  notificationSettings: '/settings/notifications',
  wifiNetwork: '/settings/wifi',
  privacyData: '/settings/privacy',
  about: '/settings/about',
  
  // New Features
  communityObstacles: '/community',
  trainingMode: '/training',
  surfaceQuality: '/surface',
  emergencyContacts: '/emergency-contacts',
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = typeof ROUTES[RouteKey];
