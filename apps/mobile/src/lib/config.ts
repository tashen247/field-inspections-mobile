import Constants from 'expo-constants';

/** API base URL: EXPO_PUBLIC_API_URL, or the dev machine's address when running in Expo Go. */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}
