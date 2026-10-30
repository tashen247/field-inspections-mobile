import {
  GEOFENCE_RADIUS_METERS,
  haversineMeters,
  type ChecklistIssue,
  type Inspection,
} from '@fim/shared';
import * as Location from 'expo-location';
import { File } from 'expo-file-system';
import { useEffect } from 'react';
import { addGpsPoint, createDraft, getDraft } from '../../db/repo';
import { getServices, syncNow } from '../../services';
import { discardLocalWork } from '../../sync/conflicts';
import { queueStart, queueSubmission } from '../../sync/submission';

export interface StartCheck {
  position: { lat: number; lng: number; accuracy: number | null } | null;
  distanceMeters: number | null;
  withinGeofence: boolean;
}

/** High-accuracy fix for the geofence check (the one moment we need precision before starting). */
export async function checkStartPosition(job: Inspection): Promise<StartCheck> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return { position: null, distanceMeters: null, withinGeofence: false };
  try {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
    ]);
    const p = fix ?? (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 })) ?? null;
    if (!p) return { position: null, distanceMeters: null, withinGeofence: false };
    const position = {
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      accuracy: p.coords.accuracy,
    };
    const distanceMeters = haversineMeters(position, job.location);
    return { position, distanceMeters, withinGeofence: distanceMeters <= GEOFENCE_RADIUS_METERS };
  } catch {
    return { position: null, distanceMeters: null, withinGeofence: false };
  }
}

/** Records the start locally first, then queues it for the server. */
export function beginInspection(job: Inspection, check: StartCheck) {
  const { db } = getServices();
  if (getDraft(db, job.id)) return;
  const startedAt = new Date().toISOString();
  createDraft(db, job, {
    startedAt,
    lat: check.position?.lat ?? null,
    lng: check.position?.lng ?? null,
    distanceM: check.distanceMeters,
  });
  if (check.position) {
    addGpsPoint(db, {
      inspectionId: job.id,
      lat: check.position.lat,
      lng: check.position.lng,
      accuracy: check.position.accuracy,
      recordedAt: startedAt,
    });
  }
  queueStart(db, job.id, {
    startedAt,
    location: {
      lat: check.position?.lat ?? job.location.lat,
      lng: check.position?.lng ?? job.location.lng,
      ...(check.position?.accuracy != null ? { accuracy: check.position.accuracy } : {}),
    },
  });
  void syncNow({ pull: false });
}

export function submitInspection(
  id: string,
): { ok: true } | { ok: false; issues: ChecklistIssue[] } {
  const result = queueSubmission(getServices().db, id);
  if (result.ok) void syncNow({ pull: false });
  return result;
}

export function discardInspectionFiles(id: string) {
  const uris = discardLocalWork(getServices().db, id);
  for (const uri of uris) {
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // already gone
    }
  }
}

/**
 * GPS trail while an inspection is open: high accuracy, but only every 25 m / 20 s, and only
 * while the inspection screens are mounted.
 */
export function useInspectionTracking(inspectionId: string, active: boolean) {
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 25, timeInterval: 20_000 },
        (p) =>
          addGpsPoint(getServices().db, {
            inspectionId,
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy,
            recordedAt: new Date(p.timestamp).toISOString(),
          }),
      );
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [inspectionId, active]);
}
