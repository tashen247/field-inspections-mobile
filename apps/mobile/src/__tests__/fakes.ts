import {
  VEHICLE_TEMPLATE,
  type ConflictDetails,
  type Inspection,
  type StartUploadBody,
  type SubmissionBody,
  type Template,
} from '@fim/shared';
import { ApiError, NetworkError, type ApiClient } from '../lib/api';
import type { FileTransport } from '../sync/engine';

export const TEMPLATE: Template = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Motor vehicle claim',
  type: 'vehicle',
  version: 1,
  schema: VEHICLE_TEMPLATE,
  createdAt: '2026-10-01T00:00:00.000Z',
};

export function makeInspection(overrides: Partial<Inspection> = {}): Inspection {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    reference: 'INS-202610-ABC234',
    templateId: TEMPLATE.id,
    templateVersion: 1,
    assigneeId: '33333333-3333-4333-8333-333333333333',
    assigneeName: 'Thandi Nkosi',
    claimNumber: 'CLM-100200',
    insuredName: 'Sipho Dlamini',
    insuredPhone: '0821234567',
    sumInsuredCents: 35_000_000,
    subject: { kind: 'vehicle', make: 'Toyota', model: 'Hilux', registration: 'CA 123-456' },
    address: { line1: '100 Rivonia Road', suburb: 'Sandton', city: 'Johannesburg' },
    location: { lat: -26.1066, lng: 28.0567 },
    dueAt: '2026-10-31T10:00:00.000Z',
    priority: 'high',
    status: 'assigned',
    version: 1,
    startedAt: null,
    submittedAt: null,
    reviewComment: null,
    createdAt: '2026-10-29T08:00:00.000Z',
    updatedAt: '2026-10-29T08:00:00.000Z',
    ...overrides,
  };
}

type Fault = 'network' | 'network-after-commit' | 500 | null;

/**
 * Just enough of the API to exercise the sync engine: idempotent submissions, multipart
 * uploads with resume, version conflicts and switchable network faults.
 */
export class FakeServer {
  inspections = new Map<string, Inspection>();
  submissionsApplied: SubmissionBody[] = [];
  idempotency = new Map<string, unknown>();
  uploads = new Map<string, { uploadId: string; parts: Map<number, string>; done: boolean }>();
  expectedFiles = new Set<string>();
  starts = 0;
  partSize = 1000;
  offline = false;
  nextFault: Fault = null;
  removedIds: string[] = [];
  calls: string[] = [];

  constructor(inspections: Inspection[] = [makeInspection()]) {
    for (const i of inspections) this.inspections.set(i.id, i);
  }

  private gate(name: string) {
    this.calls.push(name);
    if (this.offline) throw new NetworkError(new Error('offline'));
    if (this.nextFault === 'network') {
      this.nextFault = null;
      throw new NetworkError(new Error('connection reset'));
    }
    if (this.nextFault === 500) {
      this.nextFault = null;
      throw new ApiError(500, { code: 'INTERNAL', message: 'Unexpected error' });
    }
  }

  conflict(details: ConflictDetails): never {
    throw new ApiError(409, { code: 'VERSION_CONFLICT', message: 'Conflict', details });
  }

  api(): ApiClient {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- closures below need the server
    const self = this;
    const notUsed = async () => {
      throw new Error('not used in this test');
    };
    return {
      login: notUsed,
      detail: notUsed,
      review: notUsed,
      assign: notUsed,
      assessors: notUsed,
      report: notUsed,
      registerDevice: notUsed,
      async templates() {
        self.gate('templates');
        return { items: [TEMPLATE] };
      },
      async listInspections() {
        self.gate('list');
        const removedIds = self.removedIds;
        self.removedIds = [];
        return {
          items: [...self.inspections.values()],
          removedIds,
          serverTime: new Date().toISOString(),
          nextCursor: null,
        };
      },
      async start(id) {
        self.gate('start');
        self.starts += 1;
        const i = self.inspections.get(id)!;
        if (i.status === 'assigned') self.inspections.set(id, { ...i, status: 'in_progress' });
        return { inspection: self.inspections.get(id)!, distanceMeters: 12, withinGeofence: true };
      },
      async submit(id, body, key) {
        self.gate('submit');
        const prior = self.idempotency.get(key);
        if (prior) return prior as Awaited<ReturnType<ApiClient['submit']>>;
        const current = self.inspections.get(id)!;
        if (current.version !== body.baseVersion) {
          self.conflict({ reason: 'modified', baseVersion: body.baseVersion, current });
        }
        const next = { ...current, status: 'submitted' as const, version: current.version + 1 };
        self.inspections.set(id, next);
        self.submissionsApplied.push(body);
        for (const p of body.photos) self.expectedFiles.add(p.id);
        if (body.signature) self.expectedFiles.add(body.signature.fileId);
        const res = { inspection: next, pendingUploadIds: [...self.expectedFiles] };
        self.idempotency.set(key, res);
        if (self.nextFault === 'network-after-commit') {
          self.nextFault = null;
          throw new NetworkError(new Error('response lost'));
        }
        return res;
      },
      async startUpload(_id, body: StartUploadBody) {
        self.gate('startUpload');
        if (!self.expectedFiles.has(body.fileId)) {
          throw new ApiError(404, { code: 'NOT_FOUND', message: 'Upload not found' });
        }
        let u = self.uploads.get(body.fileId);
        if (u?.done) {
          return {
            fileId: body.fileId,
            alreadyUploaded: true,
            uploadId: null,
            partSize: self.partSize,
            uploadedParts: [],
            parts: [],
          };
        }
        if (!u) {
          u = { uploadId: `up-${body.fileId}`, parts: new Map(), done: false };
          self.uploads.set(body.fileId, u);
        }
        const total = Math.max(1, Math.ceil(body.sizeBytes / self.partSize));
        const parts = [];
        for (let n = 1; n <= total; n++) {
          if (!u.parts.has(n)) parts.push({ partNumber: n, url: `fake://${body.fileId}/${n}` });
        }
        return {
          fileId: body.fileId,
          alreadyUploaded: false,
          uploadId: u.uploadId,
          partSize: self.partSize,
          uploadedParts: [...u.parts].map(([partNumber, etag]) => ({ partNumber, etag })),
          parts,
        };
      },
      async completeUpload(_id, body) {
        self.gate('completeUpload');
        const u = self.uploads.get(body.fileId)!;
        u.done = true;
        self.expectedFiles.delete(body.fileId);
        return {
          fileId: body.fileId,
          uploadedAt: new Date().toISOString(),
          remaining: self.expectedFiles.size,
        };
      },
    };
  }

  transport(files: Set<string>, opts: { failOnPart?: { fileId: string; part: number } } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- closures below need the server
    const self = this;
    const t: FileTransport & { puts: string[] } = {
      puts: [],
      exists: (uri) => files.has(uri),
      async putPart(url) {
        if (self.offline) throw new NetworkError(new Error('offline'));
        const [, , fileId, n] = url.split('/');
        const part = Number(n);
        if (opts.failOnPart && opts.failOnPart.fileId === fileId && opts.failOnPart.part === part) {
          opts.failOnPart = undefined;
          throw new Error('process killed');
        }
        t.puts.push(`${fileId}#${part}`);
        const etag = `"etag-${fileId}-${part}"`;
        self.uploads.get(fileId!)!.parts.set(part, etag);
        return etag;
      },
    };
    return t;
  }
}
