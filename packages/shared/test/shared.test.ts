import { describe, expect, it } from 'vitest';
import {
  PROPERTY_TEMPLATE,
  VEHICLE_TEMPLATE,
  checklistProgress,
  findItem,
  flattenItems,
  formatDistance,
  formatZar,
  haversineMeters,
  partCount,
  s3Keys,
  jobSchema,
  reviewBodySchema,
  submissionBodySchema,
  templateBodySchema,
  validateChecklist,
  validateItemValue,
  type ChecklistItem,
} from '../src/index.js';

function completeVehicleAnswers() {
  return [
    { itemKey: 'vin_matches', value: 'pass' as const },
    { itemKey: 'odometer', value: 123456 },
    { itemKey: 'licence_disc_valid', value: 'pass' as const },
    { itemKey: 'exterior_overview', value: 'pass' as const },
    { itemKey: 'windscreen', value: 'intact' },
    { itemKey: 'lights', value: 'pass' as const },
    { itemKey: 'tread_fl', value: 5 },
    { itemKey: 'tread_fr', value: 5 },
    { itemKey: 'tread_rl', value: 4.5 },
    { itemKey: 'tread_rr', value: 4.5 },
    { itemKey: 'airbags', value: 'intact' },
    { itemKey: 'engine_starts', value: 'pass' as const },
    { itemKey: 'repairable', value: 'repair' },
    { itemKey: 'assessor_summary', value: 'Minor scuffs only.' },
  ];
}

const requiredVehiclePhotos = [
  { itemKey: 'vin_matches', shotKey: 'vin_plate' },
  { itemKey: 'odometer', shotKey: 'odometer' },
  { itemKey: 'exterior_overview', shotKey: 'front_left' },
  { itemKey: 'exterior_overview', shotKey: 'front_right' },
  { itemKey: 'exterior_overview', shotKey: 'rear_left' },
  { itemKey: 'exterior_overview', shotKey: 'rear_right' },
];

describe('templates', () => {
  it('ships valid vehicle and property templates with unique keys', () => {
    for (const body of [VEHICLE_TEMPLATE, PROPERTY_TEMPLATE]) {
      const keys = flattenItems(body).map(({ item }) => item.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(findItem(VEHICLE_TEMPLATE, 'odometer')?.kind).toBe('number');
    expect(findItem(VEHICLE_TEMPLATE, 'nope')).toBeUndefined();
  });

  it('rejects duplicate item keys', () => {
    const result = templateBodySchema.safeParse({
      diagram: 'vehicle-top',
      sections: [
        { key: 'a', title: 'A', items: [{ key: 'x', kind: 'text', label: 'X' }] },
        { key: 'b', title: 'B', items: [{ key: 'x', kind: 'text', label: 'X again' }] },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('validateChecklist', () => {
  it('accepts a complete vehicle inspection', () => {
    const issues = validateChecklist(VEHICLE_TEMPLATE, {
      answers: completeVehicleAnswers(),
      photos: requiredVehiclePhotos,
      hasSignature: true,
    });
    expect(issues).toEqual([]);
  });

  it('reports missing required items, photos and signature', () => {
    const issues = validateChecklist(VEHICLE_TEMPLATE, {
      answers: [],
      photos: [],
      hasSignature: false,
    });
    const kinds = new Set(issues.map((i) => i.kind));
    expect(kinds).toEqual(new Set(['required', 'photo_required', 'signature_required']));
    expect(
      issues.find((i) => i.itemKey === 'vin_matches' && i.kind === 'photo_required')?.message,
    ).toBe('Take the "VIN plate" photo');
  });

  it('flags unknown items and fail-without-note', () => {
    const answers = completeVehicleAnswers().map((a) =>
      a.itemKey === 'exterior_overview' ? { ...a, value: 'fail' as const } : a,
    );
    const issues = validateChecklist(VEHICLE_TEMPLATE, {
      answers: [...answers, { itemKey: 'made_up', value: 'x' }],
      photos: requiredVehiclePhotos,
      hasSignature: true,
    });
    expect(issues.map((i) => i.kind).sort()).toEqual(['note_required', 'unknown_item']);
  });

  it('enforces free photo minimums', () => {
    const body = templateBodySchema.parse({
      diagram: 'floor-plan',
      requireSignature: false,
      sections: [
        {
          key: 's',
          title: 'S',
          items: [{ key: 'w', kind: 'passFail', label: 'Walls', minPhotos: 2 }],
        },
      ],
    });
    const one = validateChecklist(body, {
      answers: [],
      photos: [{ itemKey: 'w' }],
      hasSignature: false,
    });
    expect(one[0]?.message).toBe('Walls needs at least 2 photos');
    const two = validateChecklist(body, {
      answers: [],
      photos: [{ itemKey: 'w' }, { itemKey: 'w', shotKey: null }],
      hasSignature: false,
    });
    expect(two).toEqual([]);
  });
});

describe('validateItemValue', () => {
  const num: ChecklistItem = {
    key: 'n',
    kind: 'number',
    label: 'Tread',
    min: 0,
    max: 20,
    integer: true,
    required: false,
    shots: [],
    minPhotos: 0,
  };
  it.each([
    [5, null],
    [-1, 'out_of_range'],
    [21, 'out_of_range'],
    [1.5, 'invalid_value'],
    ['5', 'invalid_value'],
    [null, null],
  ])('number %s -> %s', (value, kind) => {
    expect(validateItemValue(num, value)?.kind ?? null).toBe(kind);
  });

  it('validates pass/fail, select and text', () => {
    const pf: ChecklistItem = {
      key: 'p',
      kind: 'passFail',
      label: 'P',
      allowNa: false,
      noteOnFail: false,
      required: true,
      shots: [],
      minPhotos: 0,
    };
    expect(validateItemValue(pf, 'na')?.kind).toBe('invalid_value');
    expect(validateItemValue(pf, 'maybe')?.kind).toBe('invalid_value');
    expect(validateItemValue(pf, '  ')?.kind).toBe('required');
    const sel: ChecklistItem = {
      key: 's',
      kind: 'select',
      label: 'S',
      options: [{ value: 'a', label: 'A' }],
      required: false,
      shots: [],
      minPhotos: 0,
    };
    expect(validateItemValue(sel, 'a')).toBeNull();
    expect(validateItemValue(sel, 'b')?.kind).toBe('invalid_value');
    const txt: ChecklistItem = {
      key: 't',
      kind: 'text',
      label: 'T',
      multiline: false,
      maxLength: 3,
      required: false,
      shots: [],
      minPhotos: 0,
    };
    expect(validateItemValue(txt, 'abcd')?.kind).toBe('out_of_range');
    expect(validateItemValue(txt, 4)?.kind).toBe('invalid_value');
  });
});

describe('checklistProgress', () => {
  it('counts answered and required remaining', () => {
    const p = checklistProgress(PROPERTY_TEMPLATE, [
      { itemKey: 'address_confirmed', value: 'pass' },
      { itemKey: 'security', value: '' },
    ]);
    expect(p.answered).toBe(1);
    expect(p.total).toBe(flattenItems(PROPERTY_TEMPLATE).length);
    expect(p.requiredRemaining).toBeGreaterThan(5);
  });
});

describe('format helpers', () => {
  it('measures distance between Gqeberha and Johannesburg', () => {
    const d = haversineMeters({ lat: -33.9608, lng: 25.6022 }, { lat: -26.2041, lng: 28.0473 });
    expect(d / 1000).toBeGreaterThan(880);
    expect(d / 1000).toBeLessThan(920);
  });
  it('formats distance and rand', () => {
    expect(formatDistance(150.4)).toBe('150 m');
    expect(formatDistance(2345)).toBe('2.3 km');
    expect(formatDistance(23456)).toBe('23 km');
    expect(formatDistance(Number.NaN)).toBe('–');
    expect(formatZar(12345600)).toBe('R 123 456.00');
    expect(formatZar(-5)).toBe('-R 0.05');
  });
  it('computes part counts', () => {
    expect(partCount(1)).toBe(1);
    expect(partCount(5 * 1024 * 1024 + 1)).toBe(2);
  });
});

describe('request schemas', () => {
  it('requires a comment when sending back', () => {
    expect(
      reviewBodySchema.safeParse({ action: 'send_back', baseVersion: 2, comment: '' }).success,
    ).toBe(false);
    expect(reviewBodySchema.safeParse({ action: 'approve', baseVersion: 2 }).success).toBe(true);
  });
  it('applies defaults to submissions', () => {
    const parsed = submissionBodySchema.parse({
      baseVersion: 1,
      templateVersion: 1,
      startedAt: '2026-10-01T08:00:00Z',
      completedAt: '2026-10-01T09:00:00Z',
      answers: [{ itemKey: 'a', value: 'pass' }],
      damagePins: [],
      photos: [],
      signature: null,
      gpsTrail: [],
    });
    expect(parsed.answers[0]?.note).toBeNull();
  });
});

describe('jobs and storage keys', () => {
  it('lays out S3 keys per inspection and validates queue messages', () => {
    expect(s3Keys.photo('i', 'p')).toBe('inspections/i/photos/p.jpg');
    expect(s3Keys.signature('i', 's')).toBe('inspections/i/signature/s.png');
    expect(s3Keys.report('i', 3)).toBe('inspections/i/reports/report-v3.pdf');
    const push = jobSchema.parse({
      type: 'push',
      userId: '00000000-0000-4000-8000-000000000000',
      title: 't',
      body: 'b',
      correlationId: 'c',
    });
    expect(push).toMatchObject({ data: {} });
    expect(jobSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
});
