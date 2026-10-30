import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { openOutboxCount } from '../../db/repo';
import { useAuth } from '../../lib/auth-store';
import { useDbQuery } from '../../lib/use-db';
import { useTheme } from '../../theme';

export default function AssessorTabs() {
  const t = useTheme();
  const status = useAuth((s) => s.status);
  const role = useAuth((s) => s.session?.user.role);
  const pending = useDbQuery((db) => openOutboxCount(db), []);
  if (status !== 'signedIn') return <Redirect href="/" />;
  if (role !== 'assessor') return <Redirect href="/(manager)/inspections" />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: t.colors.primary }}>
      <Tabs.Screen
        name="jobs"
        options={{
          title: "Today's jobs",
          tabBarLabel: 'Jobs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="briefcase-outline" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'Sync',
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cloud-upload-outline" color={color as string} size={size} />
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
