import { reports, reviewEvents, type Db } from '@fim/db';
import { s3Keys, type GenerateReportJob } from '@fim/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { renderReportPdf } from '../pdf/report.js';
import { loadReportData } from '../report-data.js';
import type { BlobStore } from '../storage.js';

export type ReportOutcome =
  'generated' | 'skipped_current' | 'skipped_missing' | 'waiting_for_uploads';

/**
 * Renders and stores the PDF for the inspection's current version. Safe to run twice: a report
 * that already matches the version is left alone, so SQS redelivery never duplicates work.
 */
export async function handleGenerateReport(
  deps: { db: Db; blobs: BlobStore; log: Logger; now?: () => Date },
  job: GenerateReportJob,
): Promise<ReportOutcome> {
  const { db, blobs, log } = deps;
  const data = await loadReportData(db, job.inspectionId);
  if (!data) {
    log.warn({ inspectionId: job.inspectionId }, 'inspection not found; dropping report job');
    return 'skipped_missing';
  }
  const existing = await db.query.reports.findFirst({ where: eq(reports.inspectionId, data.id) });
  if (existing && existing.inspectionVersion === data.version) {
    log.info({ inspectionId: data.id, version: data.version }, 'report already current');
    return 'skipped_current';
  }
  if (data.photos.some((p) => !p.uploaded) || (data.signature && !data.signature.uploaded)) {
    // The final upload enqueues another job, so nothing is lost by waiting.
    log.info({ inspectionId: data.id }, 'uploads still pending; report deferred');
    return 'waiting_for_uploads';
  }

  const photos = new Map<string, Uint8Array>();
  await Promise.all(
    data.photos.map(async (p) => {
      const bytes = await blobs.get(p.s3Key);
      if (bytes) photos.set(p.id, bytes);
    }),
  );
  const signature = data.signature ? await blobs.get(data.signature.s3Key) : null;
  const generatedAt = deps.now?.() ?? new Date();
  const pdf = await renderReportPdf(data, { photos, signature, generatedAt });
  const key = s3Keys.report(data.id, data.version);
  await blobs.put(key, pdf, 'application/pdf');

  await db.transaction(async (tx) => {
    await tx
      .insert(reports)
      .values({ inspectionId: data.id, s3Key: key, inspectionVersion: data.version, generatedAt })
      .onConflictDoUpdate({
        target: reports.inspectionId,
        set: { s3Key: key, inspectionVersion: data.version, generatedAt },
      });
    await tx.insert(reviewEvents).values({
      inspectionId: data.id,
      kind: 'report_generated',
      comment: `Report for version ${data.version} (${Math.round(pdf.length / 1024)} KB)`,
    });
  });
  log.info(
    { inspectionId: data.id, version: data.version, bytes: pdf.length, key },
    'report generated',
  );
  return 'generated';
}
