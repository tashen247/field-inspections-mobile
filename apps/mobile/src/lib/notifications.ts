import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { getServices, syncNow } from '../services';
import { useAuth } from './auth-store';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('jobs', {
      name: 'Job updates',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  // Push tokens need an EAS project id; without one (plain local dev) push is simply skipped.
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

/** Registers the device for job notifications and routes taps to the right screen. */
export function useNotifications(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    registerForPush()
      .then(async (token) => {
        if (!token || cancelled) return;
        await getServices().api.registerDevice({
          expoPushToken: token,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        });
      })
      .catch(() => undefined);

    // A job was assigned or sent back: pull it straight away.
    const received = Notifications.addNotificationReceivedListener(() => void syncNow());
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { inspectionId?: string };
      if (!data?.inspectionId) return;
      const role = useAuth.getState().session?.user.role;
      void syncNow().finally(() => {
        router.push(
          role === 'manager'
            ? { pathname: '/review/[id]', params: { id: data.inspectionId! } }
            : { pathname: '/inspection/[id]', params: { id: data.inspectionId! } },
        );
      });
    });
    return () => {
      cancelled = true;
      received.remove();
      tapped.remove();
    };
  }, [enabled]);
}
