import { getDb } from './db/client';
import type { LocalDb } from './db/types';
import { createApiClient, type ApiClient } from './lib/api';
import { useAuth } from './lib/auth-store';
import { apiBaseUrl } from './lib/config';
import { SyncEngine } from './sync/engine';
import { useSyncStatus } from './sync/status';
import { expoFileTransport } from './sync/transport';

interface Services {
  db: LocalDb;
  api: ApiClient;
  engine: SyncEngine;
}

let services: Services | null = null;

/** App-wide singletons. Safe to call from screens and from the background task. */
export function getServices(): Services {
  if (services) return services;
  const db = getDb();
  const api = createApiClient({
    baseUrl: apiBaseUrl(),
    tokens: {
      get: () => useAuth.getState().session,
      set: (t) => useAuth.getState().setTokens(t),
      clear: () => useAuth.getState().signOut(),
    },
  });
  const engine = new SyncEngine({
    db,
    api,
    files: expoFileTransport,
    onProgress: () => useSyncStatus.getState().touch(),
  });
  engine.recover();
  services = { db, api, engine };
  return services;
}

/** Runs a sync and records the outcome for the UI. Never throws. */
export async function syncNow(opts: { pull?: boolean } = {}) {
  const status = useSyncStatus.getState();
  if (!useAuth.getState().session) return null;
  status.started();
  try {
    const result = await getServices().engine.run(opts);
    status.finished(result);
    return result;
  } catch (err) {
    status.failed(err instanceof Error ? err.message : String(err));
    return null;
  }
}
