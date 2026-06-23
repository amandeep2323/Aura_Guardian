import { useAppStore } from '../stores/appStore';
import { useThemeStore, type ThemeMode } from '../stores/themeStore';
import { useWifiStore } from '../stores/wifiStore';
import { 
  ArrowLeft, 
  Sun, 
  Moon, 
  Contrast,
  Volume2,
  Vibrate,
  Bell,
  Wifi,
  Shield,
  Info,
  ChevronRight,
  LogOut
} from 'lucide-react';
import Button from '../components/common/Button';

interface SettingItem {
  label: string;
  value: string;
  icon: React.ReactNode;
  hasChevron: boolean;
  action?: () => void;
}

interface SettingsSection {
  title: string;
  items: SettingItem[];
}

export default function SettingsScreen() {
  const { goBack, navigateTo } = useAppStore();
  const { theme, setTheme } = useThemeStore();
  const { disconnectAll, isConnected } = useWifiStore();

  const themes: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: 'dark', label: 'Dark', icon: <Moon className="w-5 h-5" /> },
    { value: 'light', label: 'Light', icon: <Sun className="w-5 h-5" /> },
    { value: 'high-contrast', label: 'High Contrast', icon: <Contrast className="w-5 h-5" /> },
  ];

  const settingsSections: SettingsSection[] = [
    {
      title: 'DEVICES',
      items: [
        { 
          label: 'Device Manager', 
          value: isConnected ? 'Connected' : 'Not connected',
          icon: <Wifi className="w-5 h-5" />,
          action: () => navigateTo('deviceManager'),
          hasChevron: true
        },
      ],
    },
    {
      title: 'FEEDBACK',
      items: [
        { label: 'Voice Settings', value: 'English', icon: <Volume2 className="w-5 h-5" />, hasChevron: true },
        { label: 'Haptic Settings', value: 'Medium', icon: <Vibrate className="w-5 h-5" />, hasChevron: true },
        { label: 'Notifications', value: 'All enabled', icon: <Bell className="w-5 h-5" />, hasChevron: true },
      ],
    },
    {
      title: 'PRIVACY & SECURITY',
      items: [
        { label: 'Privacy & Data', value: '', icon: <Shield className="w-5 h-5" />, hasChevron: true },
        { label: 'About Aura Guardian', value: 'v2.0.0', icon: <Info className="w-5 h-5" />, hasChevron: true },
      ],
    },
  ];

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
            <h1 className="text-xl font-bold text-white">Settings</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-6 overflow-auto">
        {/* Theme Selector */}
        <section>
          <h2 className="text-sm font-medium text-gray-400 mb-3">THEME</h2>
          <div className="grid grid-cols-3 gap-3">
            {themes.map((t) => (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                className={`p-4 rounded-xl flex flex-col items-center gap-2 transition-all ${
                  theme === t.value
                    ? 'bg-purple-600/20 border-2 border-purple-500'
                    : 'bg-gray-800 border-2 border-transparent hover:border-gray-700'
                }`}
                aria-pressed={theme === t.value}
              >
                <span className={theme === t.value ? 'text-purple-400' : 'text-gray-400'}>
                  {t.icon}
                </span>
                <span className={`text-sm ${theme === t.value ? 'text-purple-300' : 'text-gray-400'}`}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Settings Sections */}
        {settingsSections.map((section) => (
          <section key={section.title}>
            <h2 className="text-sm font-medium text-gray-400 mb-3">{section.title}</h2>
            <div className="bg-gray-800 rounded-xl overflow-hidden divide-y divide-gray-700">
              {section.items.map((item, index) => (
                <button
                  key={index}
                  onClick={item.action}
                  className="w-full p-4 flex items-center gap-4 hover:bg-gray-700/50 transition-colors text-left"
                >
                  <span className="text-gray-400">{item.icon}</span>
                  <div className="flex-1">
                    <p className="text-white font-medium">{item.label}</p>
                    {item.value && (
                      <p className="text-sm text-gray-400">{item.value}</p>
                    )}
                  </div>
                  {item.hasChevron && (
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}

        {/* Disconnect All */}
        {isConnected && (
          <section>
            <Button
              variant="danger"
              fullWidth
              onClick={disconnectAll}
              className="flex items-center justify-center gap-2"
            >
              <LogOut className="w-5 h-5" />
              Disconnect All Devices
            </Button>
          </section>
        )}

        {/* App Info */}
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-white font-bold text-lg">Aura Guardian</h3>
          <p className="text-gray-400 text-sm">Version 2.0.0</p>
          <p className="text-gray-500 text-xs mt-2">
            © 2026 Aura Guardian. All rights reserved.
          </p>
        </div>
      </main>
    </div>
  );
}

