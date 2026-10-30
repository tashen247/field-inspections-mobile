import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useAuth } from '../lib/auth-store';
import { getServices } from '../services';

export const SYNC_TASK = 'fim-background-sync';

// Must run at module load (imported from the root layout) so the OS can wake the JS runtime
// straight into this task even when no screen is mounted.
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    if (!useAuth.getState().session) await useAuth.getState().hydrate();
    if (!useAuth.getState().session) return BackgroundTask.BackgroundTaskResult.Success;
    await getServices().engine.run();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync() {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  if (!(await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) {
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 });
  }
  return true;
}
