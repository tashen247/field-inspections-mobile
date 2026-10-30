import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** The slice of S3 the API needs. Kept narrow so it is easy to reason about and fake. */
export interface Storage {
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[] | null>;
  presignPart(key: string, uploadId: string, partNumber: number): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  presignGet(key: string, downloadName?: string): Promise<string>;
}

export interface S3StorageOptions {
  region: string;
  bucket: string;
  endpoint?: string | undefined;
  /** Endpoint baked into pre-signed URLs (e.g. LAN address of LocalStack for a phone). */
  publicEndpoint?: string | undefined;
  presignTtlSeconds: number;
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string }).name;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NoSuchUpload' || name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

export function createS3Storage(opts: S3StorageOptions): Storage {
  const make = (endpoint?: string) =>
    new S3Client({
      region: opts.region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  const s3 = make(opts.endpoint);
  const signer = opts.publicEndpoint ? make(opts.publicEndpoint) : s3;
  const Bucket = opts.bucket;
  const expiresIn = opts.presignTtlSeconds;

  return {
    async createMultipartUpload(key, contentType) {
      const res = await s3.send(
        new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }),
      );
      if (!res.UploadId) throw new Error('S3 did not return an UploadId');
      return res.UploadId;
    },

    async listParts(key, uploadId) {
      try {
        const parts: UploadedPart[] = [];
        let marker: string | undefined;
        do {
          const res = await s3.send(
            new ListPartsCommand({
              Bucket,
              Key: key,
              UploadId: uploadId,
              PartNumberMarker: marker,
            }),
          );
          for (const p of res.Parts ?? []) {
            if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag });
          }
          marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
        } while (marker);
        return parts;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    presignPart(key, uploadId, partNumber) {
      return getSignedUrl(
        signer,
        new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn },
      );
    },

    async completeMultipartUpload(key, uploadId, parts) {
      const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: sorted.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    },

    async abortMultipartUpload(key, uploadId) {
      try {
        await s3.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },

    async exists(key) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },

    presignGet(key, downloadName) {
      return getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ...(downloadName
            ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` }
            : {}),
        }),
        { expiresIn },
      );
    },
  };
}
