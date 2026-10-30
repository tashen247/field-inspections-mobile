import { router } from 'expo-router';
import { Alert, Switch } from 'react-native';
import { Button, Card, Row, Screen, Text } from '../../components/ui';
import { getMeta, openOutboxCount } from '../../db/repo';
import { useAuth } from '../../lib/auth-store';
import { apiBaseUrl } from '../../lib/config';
import { useDbQuery } from '../../lib/use-db';
import { useTheme } from '../../theme';

export function SettingsScreen() {
  const t = useTheme();
  const user = useAuth((s) => s.session?.user);
  const biometric = useAuth((s) => s.biometricEnabled);
  const { pending, lastSync } = useDbQuery(
    (db) => ({ pending: openOutboxCount(db), lastSync: getMeta(db, 'lastSyncServerTime') }),
    [],
  );

  const signOut = () => {
    const go = async () => {
      await useAuth.getState().signOut();
      router.replace('/login');
    };
    if (pending > 0) {
      Alert.alert(
        'Unsynced work',
        `${pending} item${pending === 1 ? '' : 's'} have not synced yet. They stay safely on this device and sync after you sign back in.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out', style: 'destructive', onPress: () => void go() },
        ],
      );
    } else void go();
  };

  return (
    <Screen scroll>
      <Card>
        <Text variant="heading">{user?.name}</Text>
        <Text variant="muted">{user?.email}</Text>
        <Text variant="caption">
          {user?.role === 'manager' ? 'Inspection manager' : 'Field assessor'}
        </Text>
      </Card>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ flex: 1 }}>Unlock with Face ID or fingerprint</Text>
          <Switch
            accessibilityLabel="Biometric quick unlock"
            value={biometric}
            trackColor={{ true: t.colors.primary }}
            onValueChange={async (v) => {
              const ok = await useAuth.getState().setBiometric(v);
              if (!ok && v)
                Alert.alert(
                  'Not available',
                  'Set up Face ID or a fingerprint on this device first.',
                );
            }}
          />
        </Row>
        <Text variant="caption">Theme follows your device's light or dark mode.</Text>
      </Card>
      <Card>
        <Text variant="label">Server</Text>
        <Text variant="muted">{apiBaseUrl()}</Text>
        {lastSync ? (
          <Text variant="caption">Last synced {new Date(lastSync).toLocaleString('en-ZA')}</Text>
        ) : null}
      </Card>
      <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={signOut} />
    </Screen>
  );
}
