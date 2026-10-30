import NetInfo from '@react-native-community/netinfo';
import type { LatLng } from '@fim/shared';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)), []);
  return online;
}

/**
 * Coarse position for the jobs list (distance sorting). Uses balanced accuracy and a 100 m
 * distance filter; high accuracy is reserved for an active inspection.
 */
export function useCoarseLocation(): LatLng | null {
  const [pos, setPos] = useState<LatLng | null>(null);
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted || cancelled) return;
      const last = await Location.getLastKnownPositionAsync();
      if (last && !cancelled) setPos({ lat: last.coords.latitude, lng: last.coords.longitude });
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 100, timeInterval: 30_000 },
        (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      );
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
  return pos;
}
