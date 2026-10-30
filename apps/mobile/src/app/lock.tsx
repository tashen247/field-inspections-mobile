import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { Button, Screen, Text } from '../components/ui';
import { useAuth } from '../lib/auth-store';
import { useTheme } from '../theme';

export default function Lock() {
  const t = useTheme();
  const name = useAuth((s) => s.session?.user.name);
  const tryUnlock = useCallback(async () => {
    if (await useAuth.getState().unlock()) router.replace('/');
  }, []);
  useEffect(() => {
    void tryUnlock();
  }, [tryUnlock]);
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Ionicons name="finger-print" size={72} color={t.colors.primary} />
        <Text variant="heading">Welcome back{name ? `, ${name.split(' ')[0]}` : ''}</Text>
        <Text variant="muted">Unlock to continue. Your work is safe on this device.</Text>
        <Button title="Unlock" icon="lock-open-outline" onPress={tryUnlock} />
        <Button
          title="Sign in with password instead"
          variant="ghost"
          onPress={async () => {
            await useAuth.getState().signOut();
            router.replace('/login');
          }}
        />
      </View>
    </Screen>
  );
}
