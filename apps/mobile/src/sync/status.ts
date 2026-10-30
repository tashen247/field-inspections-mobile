import { create } from 'zustand';
import type { SyncResult } from './engine';

interface SyncStatus {
  running: boolean;
  lastRunAt: string | null;
  lastResult: SyncResult | null;
  lastError: string | null;
  /** Bumped on every op so progress views refresh. */
  tick: number;
  started(): void;
  finished(r: SyncResult): void;
  failed(message: string): void;
  touch(): void;
}

export const useSyncStatus = create<SyncStatus>((set) => ({
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  tick: 0,
  started: () => set({ running: true }),
  finished: (r) =>
    set({ running: false, lastResult: r, lastError: null, lastRunAt: new Date().toISOString() }),
  failed: (message) =>
    set({ running: false, lastError: message, lastRunAt: new Date().toISOString() }),
  touch: () => set((s) => ({ tick: s.tick + 1 })),
}));
