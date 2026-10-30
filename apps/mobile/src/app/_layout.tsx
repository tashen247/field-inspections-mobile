import '../sync/background';
import NetInfo from '@react-native-community/netinfo';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth-store';
import { useNotifications } from '../lib/notifications';
import { getServices, syncNow } from '../services';
import { registerBackgroundSync } from '../sync/background';
import { useTheme } from '../theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, networkMode: 'offlineFirst' },
    mutations: { networkMode: 'online' },
  },
});

// TanStack Query follows real connectivity and app focus.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)),
);

export default function RootLayout() {
  const theme = useTheme();
  const status = useAuth((s) => s.status);
  const role = useAuth((s) => s.session?.user.role);
  useNotifications(status === 'signedIn');

  useEffect(() => {
    void useAuth.getState().hydrate();
  }, []);

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  // Sync triggers for assessors: sign-in, regaining signal, returning to the app, and a timer.
  useEffect(() => {
    if (status !== 'signedIn' || role !== 'assessor') return;
    getServices();
    void syncNow();
    void registerBackgroundSync().catch(() => undefined);
    let wasOffline = false;
    const unsubNet = NetInfo.addEventListener((s) => {
      const offline = s.isConnected === false;
      if (wasOffline && !offline) void syncNow();
      wasOffline = offline;
    });
    const appSub = AppState.addEventListener('change', (state) => {
      if (Platform.OS !== 'web') focusManager.setFocused(state === 'active');
      if (state === 'active') void syncNow();
    });
    const timer = setInterval(() => void syncNow(), 60_000);
    return () => {
      unsubNet();
      appSub.remove();
      clearInterval(timer);
    };
  }, [status, role]);

  const navTheme = theme.dark ? DarkTheme : DefaultTheme;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider
            value={{
              ...navTheme,
              colors: {
                ...navTheme.colors,
                primary: theme.colors.primary,
                background: theme.colors.background,
                card: theme.colors.surface,
                text: theme.colors.text,
                border: theme.colors.border,
              },
            }}
          >
            <StatusBar style={theme.dark ? 'light' : 'dark'} />
            <Stack screenOptions={{ headerBackTitle: 'Back' }}>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="lock" options={{ headerShown: false }} />
              <Stack.Screen name="(assessor)" options={{ headerShown: false }} />
              <Stack.Screen name="(manager)" options={{ headerShown: false }} />
              <Stack.Screen name="inspection/[id]/index" options={{ title: 'Inspection' }} />
              <Stack.Screen name="inspection/[id]/checklist" options={{ title: 'Checklist' }} />
              <Stack.Screen
                name="inspection/[id]/camera"
                options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }}
              />
              <Stack.Screen name="inspection/[id]/damage" options={{ title: 'Damage markup' }} />
              <Stack.Screen
                name="inspection/[id]/signature"
                options={{ title: 'Client signature', presentation: 'modal' }}
              />
              <Stack.Screen
                name="inspection/[id]/submit"
                options={{ title: 'Review and submit' }}
              />
              <Stack.Screen
                name="inspection/[id]/conflict"
                options={{ title: 'Needs your decision', presentation: 'modal' }}
              />
              <Stack.Screen
                name="inspection/[id]/photo/[photoId]"
                options={{ title: 'Photo', presentation: 'modal' }}
              />
              <Stack.Screen name="review/[id]" options={{ title: 'Review' }} />
              <Stack.Screen
                name="review/assign/[id]"
                options={{ title: 'Assign assessor', presentation: 'modal' }}
              />
            </Stack>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
