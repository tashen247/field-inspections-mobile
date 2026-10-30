import { File, Paths, UploadType } from 'expo-file-system';
import { NetworkError } from '../lib/api';
import { uuid } from '../lib/uuid';
import type { FileTransport } from './engine';

function header(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

/**
 * Uploads straight from disk with the native uploader, so large photos never pass through
 * the JS heap. Parts other than a whole-file upload are cut into a temporary file first.
 */
export const expoFileTransport: FileTransport = {
  exists(uri) {
    return new File(uri).exists;
  },

  async putPart(url, uri, start, end, contentType) {
    const source = new File(uri);
    const whole = start === 0 && end >= source.size;
    let body = source;
    let temp: File | null = null;
    if (!whole) {
      const handle = source.open();
      try {
        handle.offset = start;
        const bytes = handle.readBytesSync(end - start);
        temp = new File(Paths.cache, `part-${uuid()}.bin`);
        temp.create({ overwrite: true });
        temp.write(bytes);
        body = temp;
      } finally {
        handle.close();
      }
    }
    try {
      const res = await body.upload(url, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        headers: { 'content-type': contentType },
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Storage rejected the upload (HTTP ${res.status})`);
      }
      const etag = header(res.headers, 'etag');
      if (!etag) throw new Error('Storage did not return an ETag');
      return etag;
    } catch (err) {
      if (err instanceof Error && /HTTP|ETag/.test(err.message)) throw err;
      throw new NetworkError(err);
    } finally {
      if (temp?.exists) temp.delete();
    }
  },
};
