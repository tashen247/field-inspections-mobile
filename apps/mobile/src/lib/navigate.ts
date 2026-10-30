import type { LatLng } from '@fim/shared';
import { Linking, Platform } from 'react-native';

/** Opens turn-by-turn directions in Apple Maps (iOS) or Google Maps (Android). */
export async function openDirections(to: LatLng, label: string) {
  const dest = `${to.lat},${to.lng}`;
  const native =
    Platform.OS === 'ios'
      ? `maps://?daddr=${dest}&q=${encodeURIComponent(label)}`
      : `google.navigation:q=${dest}`;
  const web = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  try {
    if (await Linking.canOpenURL(native)) return await Linking.openURL(native);
  } catch {
    // fall through to the browser
  }
  await Linking.openURL(web);
}
