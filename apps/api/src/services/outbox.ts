import type { Job } from '@fim/shared';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db, DbOrTx } from '@fim/db';
import { jobOutbox } from '@fim/db';
import type { JobQueue } from './queue.js';

/** Record jobs inside the caller's transaction. */
export async function addToOutbox(tx: DbOrTx, jobs: Job[]): Promise<void> {
  if (jobs.length === 0) return;
  await tx.insert(jobOutbox).values(jobs.map((payload) => ({ payload })));
}

export interface OutboxRelay {
  /** Send everything currently in the outbox. Safe to call concurrently. */
  flush(): Promise<number>;
  start(intervalMs?: number): void;
  stop(): void;
}

export function createOutboxRelay(db: Db, queue: JobQueue, log: Logger): OutboxRelay {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<number> | null = null;

  async function drain(): Promise<number> {
    let sent = 0;
    for (;;) {
      // Claim a batch with SKIP LOCKED so several API tasks can relay in parallel.
      const batch = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(jobOutbox)
          .orderBy(asc(jobOutbox.id))
          .limit(25)
          .for('update', { skipLocked: true });
        const done: number[] = [];
        for (const row of rows) {
          try {
            await queue.enqueue(row.payload as Job);
            done.push(row.id);
          } catch (err) {
            log.warn({ err, outboxId: row.id }, 'outbox relay failed; will retry');
            await tx
              .update(jobOutbox)
              .set({ attempts: sql`${jobOutbox.attempts} + 1`, lastError: String(err) })
              .where(eq(jobOutbox.id, row.id));
          }
        }
        if (done.length) await tx.delete(jobOutbox).where(inArray(jobOutbox.id, done));
        return { claimed: rows.length, done: done.length };
      });
      sent += batch.done;
      if (batch.claimed < 25 || batch.done === 0) return sent;
    }
  }

  return {
    flush() {
      running ??= drain().finally(() => {
        running = null;
      });
      return running;
    },
    start(intervalMs = 5000) {
      timer = setInterval(() => {
        this.flush().catch((err: unknown) => log.error({ err }, 'outbox relay error'));
      }, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
