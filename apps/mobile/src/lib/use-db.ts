import { addDatabaseChangeListener } from 'expo-sqlite';
import { useEffect, useMemo, useState, type DependencyList } from 'react';
import { getDb } from '../db/client';
import type { LocalDb } from '../db/types';

let version = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let subscribed = false;

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  getDb();
  // Coalesce bursts (a sync touches many rows) into one re-render.
  addDatabaseChangeListener(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      version += 1;
      for (const l of listeners) l();
    }, 60);
  });
}

/** Runs a synchronous repository query and re-runs it whenever the local database changes. */
export function useDbQuery<T>(query: (db: LocalDb) => T, deps: DependencyList): T {
  const [tick, setTick] = useState(version);
  useEffect(() => {
    ensureSubscribed();
    const l = () => setTick(version);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => query(getDb()), [tick, ...deps]);
}
