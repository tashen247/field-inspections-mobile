import { devices, type Db } from '@fim/db';
import type { PushJob } from '@fim/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** Sends one notification to every device the user is signed in on, via Expo's push service. */
export async function handlePush(
  deps: {
    db: Db;
    log: Logger;
    fetch?: typeof fetch;
    accessToken?: string | undefined;
    dryRun?: boolean;
  },
  job: PushJob,
): Promise<{ sent: number; removed: number }> {
  const { db, log } = deps;
  const rows = await db.select().from(devices).where(eq(devices.userId, job.userId));
  if (rows.length === 0) {
    log.info({ userId: job.userId }, 'no registered devices; push skipped');
    return { sent: 0, removed: 0 };
  }
  const messages = rows.map((d) => ({
    to: d.expoPushToken,
    title: job.title,
    body: job.body,
    data: job.data,
    sound: 'default',
    channelId: 'jobs',
    priority: 'high',
  }));
  if (deps.dryRun) {
    log.info({ userId: job.userId, title: job.title, devices: rows.length }, 'push (dry run)');
    return { sent: rows.length, removed: 0 };
  }

  const res = await (deps.fetch ?? fetch)(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(deps.accessToken ? { authorization: `Bearer ${deps.accessToken}` } : {}),
    },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Expo push service returned HTTP ${res.status}`);
  const { data: tickets } = (await res.json()) as { data: ExpoTicket[] };

  // Tokens for uninstalled apps are dead; forget them so we stop sending.
  const dead = tickets
    .map((t, i) =>
      t.status === 'error' && t.details?.error === 'DeviceNotRegistered'
        ? rows[i]?.expoPushToken
        : null,
    )
    .filter((t): t is string => !!t);
  if (dead.length) await db.delete(devices).where(inArray(devices.expoPushToken, dead));
  const sent = tickets.filter((t) => t.status === 'ok').length;
  log.info({ userId: job.userId, sent, removed: dead.length }, 'push sent');
  return { sent, removed: dead.length };
}
