import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface BlobStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export function createS3BlobStore(opts: {
  region: string;
  bucket: string;
  endpoint?: string | undefined;
}): BlobStore {
  const s3 = new S3Client({
    region: opts.region,
    ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
  });
  return {
    async get(key) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
        return res.Body ? await res.Body.transformToByteArray() : null;
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === 'NoSuchKey' || name === 'NotFound') return null;
        throw err;
      }
    },
    async put(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({ Bucket: opts.bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
  };
}
