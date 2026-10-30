/**
 * Drives the definition-of-done flow over HTTP against a running stack, exactly as the app
 * would: manager assigns, assessor starts, submits 10 photos + pins + signature (and retries the
 * submission to prove it is idempotent), uploads the files, manager approves, and the PDF the
 * worker produces is saved to docs/sample-report.pdf.
 *
 *   docker compose up -d && pnpm dev:backend   # in one terminal
 *   pnpm --filter @fim/api demo:flow           # in another
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  flattenItems,
  type Inspection,
  type ListInspectionsResponse,
  type LoginResponse,
  type ReportResponse,
  type StartUploadResponse,
  type SubmissionBody,
  type SubmissionResponse,
  type TemplateListResponse,
} from '@fim/shared';
import { DEMO_PASSWORD, DEMO_USERS } from '../src/db/seed-data.js';

const API = process.env.API_URL ?? 'http://localhost:3000';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = (name: string) => readFileSync(path.join(root, 'scripts/fixtures', name));
const step = (msg: string) => console.log(`\n▸ ${msg}`);

async function call<T>(
  token: string | null,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as T };
}

const login = async (email: string) =>
  (await call<LoginResponse>(null, 'POST', '/v1/auth/login', { email, password: DEMO_PASSWORD }))
    .body;

const manager = await login(DEMO_USERS[2]!.email);
const assessor = await login(DEMO_USERS[0]!.email);
console.log(`Signed in as ${manager.user.name} (manager) and ${assessor.user.name} (assessor)`);

step('Manager assigns an unassigned Durban job to the assessor');
const all = await call<ListInspectionsResponse>(
  manager.accessToken,
  'GET',
  '/v1/inspections?status=assigned&limit=500',
);
const target =
  all.body.items.find((i) => i.assigneeId === null && i.subject.kind === 'vehicle') ??
  all.body.items.find((i) => i.subject.kind === 'vehicle');
if (!target) throw new Error('No vehicle job found; run pnpm db:seed first');
const assigned = await call<Inspection>(
  manager.accessToken,
  'PATCH',
  `/v1/inspections/${target.id}/assign`,
  {
    assigneeId: assessor.user.id,
    baseVersion: target.version,
  },
);
console.log(
  `  ${assigned.body.reference} · ${assigned.body.insuredName} · ${assigned.body.address.line1}, ${assigned.body.address.city} -> v${assigned.body.version}`,
);

step('Assessor downloads jobs and templates (delta sync)');
const sync = await call<ListInspectionsResponse>(
  assessor.accessToken,
  'GET',
  '/v1/inspections?assignedTo=me',
);
const job = sync.body.items.find((i) => i.id === target.id)!;
const templates = await call<TemplateListResponse>(assessor.accessToken, 'GET', '/v1/templates');
const template = templates.body.items.find((t) => t.id === job.templateId)!.schema;
console.log(`  ${sync.body.items.length} jobs, ${templates.body.items.length} templates`);

step('Starts on site (inside the 200 m geofence)');
const startedAt = new Date(Date.now() - 50 * 60_000).toISOString();
const start = await call<{ distanceMeters: number; withinGeofence: boolean }>(
  assessor.accessToken,
  'POST',
  `/v1/inspections/${job.id}/start`,
  {
    startedAt,
    location: { lat: job.location.lat + 0.0003, lng: job.location.lng - 0.0002, accuracy: 7 },
  },
);
console.log(
  `  ${Math.round(start.body.distanceMeters)} m from the address, within geofence: ${start.body.withinGeofence}`,
);

step('Completes the checklist offline: answers, 10 photos, damage pins, signature');
const answers = flattenItems(template).map(({ item }) => {
  const value =
    item.key === 'exterior_overview'
      ? 'fail'
      : item.kind === 'passFail'
        ? 'pass'
        : item.kind === 'number'
          ? item.key === 'odometer'
            ? 123456
            : item.key === 'estimate_zar'
              ? 18500
              : 4.5
          : item.kind === 'select'
            ? item.options[0]!.value
            : 'Dent and scratches on the left rear door, consistent with the claim. Vehicle otherwise sound.';
  return {
    itemKey: item.key,
    value,
    note:
      item.key === 'exterior_overview'
        ? 'Left rear door dented, paint scratched over 30 cm.'
        : null,
  };
});
const shotFiles: [string, string | null, string][] = [
  ['vin_matches', 'vin_plate', 'vin_plate.jpg'],
  ['odometer', 'odometer', 'odometer.jpg'],
  ['exterior_overview', 'front_left', 'front_left.jpg'],
  ['exterior_overview', 'front_right', 'front_right.jpg'],
  ['exterior_overview', 'rear_left', 'rear_left.jpg'],
  ['exterior_overview', 'rear_right', 'rear_right.jpg'],
  ['exterior_overview', null, 'rear_left.jpg'],
  ['exterior_overview', null, 'front_left.jpg'],
  ['windscreen', null, 'front_right.jpg'],
  ['interior_notes', null, 'odometer.jpg'],
];
const photos = shotFiles.map(([itemKey, shotKey, file], n) => ({
  id: randomUUID(),
  itemKey,
  shotKey,
  file,
  takenAt: new Date(Date.parse(startedAt) + (n + 2) * 60_000).toISOString(),
  lat: job.location.lat + 0.0001,
  lng: job.location.lng,
  sizeBytes: fixture(file).length,
}));
const sigBytes = fixture('signature.png');
const signature = {
  fileId: randomUUID(),
  signedName: job.insuredName,
  signedAt: new Date().toISOString(),
  sizeBytes: sigBytes.length,
};
const body: SubmissionBody = {
  baseVersion: job.version,
  templateVersion: job.templateVersion,
  startedAt,
  completedAt: new Date().toISOString(),
  answers,
  damagePins: [
    {
      id: randomUUID(),
      diagram: 'vehicle-top',
      x: 0.14,
      y: 0.7,
      severity: 'moderate',
      note: 'Dent, left rear door',
    },
    {
      id: randomUUID(),
      diagram: 'vehicle-top',
      x: 0.86,
      y: 0.22,
      severity: 'minor',
      note: 'Scuff on right front wing',
    },
  ],
  photos: photos.map(({ file: _file, ...p }) => p),
  signature,
  gpsTrail: [0, 1, 2, 3].map((n) => ({
    lat: job.location.lat + 0.0003 - n * 0.0001,
    lng: job.location.lng - 0.0002 + n * 0.00005,
    accuracy: 6 + n,
    recordedAt: new Date(Date.parse(startedAt) + n * 10 * 60_000).toISOString(),
  })),
};

step('Back online: submit, then retry the same request as if the app was killed mid-sync');
const key = randomUUID();
const first = await call<SubmissionResponse>(
  assessor.accessToken,
  'PUT',
  `/v1/inspections/${job.id}/submission`,
  body,
  { 'idempotency-key': key },
);
const retry = await call<SubmissionResponse>(
  assessor.accessToken,
  'PUT',
  `/v1/inspections/${job.id}/submission`,
  body,
  { 'idempotency-key': key },
);
console.log(
  `  first: v${first.body.inspection.version}, ${first.body.pendingUploadIds.length} uploads pending`,
);
console.log(
  `  retry: replayed=${retry.headers.get('idempotent-replayed')}, same version v${retry.body.inspection.version}`,
);

step('Uploads photos and signature (resumable multipart)');
const uploads = [
  ...photos.map((p) => ({
    fileId: p.id,
    kind: 'photo' as const,
    bytes: fixture(p.file),
    type: 'image/jpeg' as const,
  })),
  {
    fileId: signature.fileId,
    kind: 'signature' as const,
    bytes: sigBytes,
    type: 'image/png' as const,
  },
];
for (const u of uploads) {
  const slot = await call<StartUploadResponse>(
    assessor.accessToken,
    'POST',
    `/v1/inspections/${job.id}/photos/upload`,
    {
      fileId: u.fileId,
      kind: u.kind,
      contentType: u.type,
      sizeBytes: u.bytes.length,
    },
  );
  const put = await fetch(slot.body.parts[0]!.url, {
    method: 'PUT',
    body: new Uint8Array(u.bytes),
  });
  const done = await call<{ remaining: number }>(
    assessor.accessToken,
    'POST',
    `/v1/inspections/${job.id}/photos/complete`,
    {
      fileId: u.fileId,
      uploadId: slot.body.uploadId,
      parts: [{ partNumber: 1, etag: put.headers.get('etag') }],
    },
  );
  process.stdout.write(`  ${u.kind} uploaded, ${done.body.remaining} left\n`);
}

step('Manager approves');
const approved = await call<Inspection>(
  manager.accessToken,
  'PATCH',
  `/v1/inspections/${job.id}/review`,
  {
    action: 'approve',
    baseVersion: first.body.inspection.version,
    comment: 'Damage consistent with the claim. Approved for repair.',
  },
);
console.log(`  ${approved.body.reference} is ${approved.body.status} (v${approved.body.version})`);

step('Waiting for the worker to render the PDF');
const approvedAt = Date.now();
let report: ReportResponse | null = null;
for (let i = 0; i < 60 && !report; i++) {
  const res = await fetch(`${API}/v1/inspections/${job.id}/report`, {
    headers: { authorization: `Bearer ${manager.accessToken}` },
  });
  if (res.ok) {
    const r = (await res.json()) as ReportResponse;
    if (Date.parse(r.generatedAt) >= approvedAt - 5000) report = r;
  }
  if (!report) await new Promise((r) => setTimeout(r, 1000));
}
if (!report) throw new Error('Report was not generated; is the worker running?');
const pdf = new Uint8Array(await (await fetch(report.url)).arrayBuffer());
const out = path.join(root, 'docs/sample-report.pdf');
writeFileSync(out, pdf);
console.log(`  saved ${Math.round(pdf.length / 1024)} KB to docs/sample-report.pdf`);
console.log('\nDone: assigned → started → submitted (idempotent) → uploaded → approved → PDF.');
