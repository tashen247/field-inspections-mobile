import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../lib/auth-store';
import { useTheme } from '../../theme';

export default function ManagerTabs() {
  const t = useTheme();
  const status = useAuth((s) => s.status);
  const role = useAuth((s) => s.session?.user.role);
  if (status !== 'signedIn') return <Redirect href="/" />;
  if (role !== 'manager') return <Redirect href="/(assessor)/jobs" />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: t.colors.primary }}>
      <Tabs.Screen
        name="inspections"
        options={{
          title: 'Inspections',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="file-tray-full-outline" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color as string} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
