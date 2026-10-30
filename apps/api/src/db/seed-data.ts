import {
  PROPERTY_TEMPLATE,
  VEHICLE_TEMPLATE,
  type Address,
  type InspectionStatus,
  type Priority,
  type Subject,
} from '@fim/shared';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { inspections, templates, users } from './schema.js';
import { hashPassword } from '../lib/password.js';

export const DEMO_PASSWORD = 'Inspect!2026';

export const DEMO_USERS = [
  {
    email: 'thandi.nkosi@demo.fim.co.za',
    name: 'Thandi Nkosi',
    role: 'assessor' as const,
    city: 'Johannesburg',
  },
  {
    email: 'pieter.vanwyk@demo.fim.co.za',
    name: 'Pieter van Wyk',
    role: 'assessor' as const,
    city: 'Gqeberha',
  },
  {
    email: 'ayesha.moodley@demo.fim.co.za',
    name: 'Ayesha Moodley',
    role: 'manager' as const,
    city: 'Durban',
  },
];

interface Place {
  line1: string;
  suburb: string;
  city: string;
  province: string;
  postalCode: string;
  lat: number;
  lng: number;
}

/** Real streets with approximate coordinates; house numbers vary per inspection. */
const PLACES: Place[] = [
  {
    line1: 'Rivonia Road',
    suburb: 'Sandton',
    city: 'Johannesburg',
    province: 'Gauteng',
    postalCode: '2196',
    lat: -26.1066,
    lng: 28.0567,
  },
  {
    line1: 'Jan Smuts Avenue',
    suburb: 'Parktown North',
    city: 'Johannesburg',
    province: 'Gauteng',
    postalCode: '2193',
    lat: -26.1452,
    lng: 28.0306,
  },
  {
    line1: 'William Nicol Drive',
    suburb: 'Fourways',
    city: 'Johannesburg',
    province: 'Gauteng',
    postalCode: '2191',
    lat: -26.0189,
    lng: 28.0102,
  },
  {
    line1: 'Beyers Naudé Drive',
    suburb: 'Northcliff',
    city: 'Johannesburg',
    province: 'Gauteng',
    postalCode: '2195',
    lat: -26.1441,
    lng: 27.9698,
  },
  {
    line1: 'Oxford Road',
    suburb: 'Rosebank',
    city: 'Johannesburg',
    province: 'Gauteng',
    postalCode: '2196',
    lat: -26.1447,
    lng: 28.0417,
  },
  {
    line1: 'New Road',
    suburb: 'Midrand',
    city: 'Johannesburg',
    province: 'Gauteng',
    postalCode: '1685',
    lat: -25.9992,
    lng: 28.1263,
  },
  {
    line1: 'Main Road',
    suburb: 'Walmer',
    city: 'Gqeberha',
    province: 'Eastern Cape',
    postalCode: '6070',
    lat: -33.9786,
    lng: 25.5862,
  },
  {
    line1: 'Cape Road',
    suburb: 'Mill Park',
    city: 'Gqeberha',
    province: 'Eastern Cape',
    postalCode: '6045',
    lat: -33.9577,
    lng: 25.5836,
  },
  {
    line1: 'Marine Drive',
    suburb: 'Summerstrand',
    city: 'Gqeberha',
    province: 'Eastern Cape',
    postalCode: '6001',
    lat: -34.0013,
    lng: 25.6688,
  },
  {
    line1: 'Heugh Road',
    suburb: 'Walmer',
    city: 'Gqeberha',
    province: 'Eastern Cape',
    postalCode: '6070',
    lat: -33.9849,
    lng: 25.5833,
  },
  {
    line1: 'Kragga Kamma Road',
    suburb: 'Lorraine',
    city: 'Gqeberha',
    province: 'Eastern Cape',
    postalCode: '6070',
    lat: -33.9699,
    lng: 25.5107,
  },
  {
    line1: 'Florida Road',
    suburb: 'Morningside',
    city: 'Durban',
    province: 'KwaZulu-Natal',
    postalCode: '4001',
    lat: -29.8268,
    lng: 31.0172,
  },
  {
    line1: 'Umhlanga Rocks Drive',
    suburb: 'Umhlanga',
    city: 'Durban',
    province: 'KwaZulu-Natal',
    postalCode: '4319',
    lat: -29.7264,
    lng: 31.0827,
  },
  {
    line1: 'Musgrave Road',
    suburb: 'Berea',
    city: 'Durban',
    province: 'KwaZulu-Natal',
    postalCode: '4001',
    lat: -29.8461,
    lng: 31.0019,
  },
  {
    line1: 'Jan Hofmeyr Road',
    suburb: 'Westville',
    city: 'Durban',
    province: 'KwaZulu-Natal',
    postalCode: '3629',
    lat: -29.8357,
    lng: 30.9301,
  },
];

const VEHICLES = [
  ['Toyota', 'Hilux 2.4 GD-6'],
  ['Volkswagen', 'Polo Vivo 1.4'],
  ['Ford', 'Ranger 2.0 XLT'],
  ['Suzuki', 'Swift 1.2 GL'],
  ['Toyota', 'Corolla Cross 1.8'],
  ['Nissan', 'Navara 2.5 dCi'],
  ['Hyundai', 'Grand i10 1.2'],
  ['Kia', 'Picanto 1.0'],
  ['Isuzu', 'D-Max 1.9'],
  ['BMW', '320i M Sport'],
  ['Mercedes-Benz', 'C200'],
  ['Renault', 'Kwid 1.0'],
] as const;

const COLOURS = ['White', 'Silver', 'Grey', 'Black', 'Red', 'Blue'];
const FIRST = [
  'Sipho',
  'Lerato',
  'Johan',
  'Nomvula',
  'Rajesh',
  'Anele',
  'Michelle',
  'Bongani',
  'Fatima',
  'Ruan',
  'Zanele',
  'Kagiso',
  'Priya',
  'Werner',
];
const LAST = [
  'Dlamini',
  'Botha',
  'Naidoo',
  'Mokoena',
  'Pillay',
  'Khumalo',
  'Smit',
  'Ndlovu',
  'Pretorius',
  'Govender',
  'Mahlangu',
  'Jacobs',
];

/** Small deterministic PRNG so seeds are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

function registration(rand: () => number, province: string): string {
  const L = () => pick(rand, 'BCDFGHJKLMNPRSTVWXYZ'.split(''));
  const d = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('');
  if (province === 'Gauteng') return `${L()}${L()} ${d(2)} ${L()}${L()} GP`;
  if (province === 'KwaZulu-Natal') return `ND ${d(3)}-${d(3)}`;
  return `${L()}${L()}${L()} ${d(3)} EC`;
}

export interface SeedOptions {
  count: number;
  seed?: number;
  /** Mix of statuses (for load testing) instead of fresh assigned jobs (for demos). */
  mixedStatuses?: boolean;
  now?: Date;
}

export async function seedUsersAndTemplates(db: Db) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await db
    .insert(users)
    .values(DEMO_USERS.map(({ email, name, role }) => ({ email, name, role, passwordHash })))
    .onConflictDoNothing({ target: users.email });
  await db
    .insert(templates)
    .values([
      {
        name: 'Motor vehicle claim',
        type: 'vehicle' as const,
        version: 1,
        schema: VEHICLE_TEMPLATE,
      },
      {
        name: 'Residential property',
        type: 'property' as const,
        version: 1,
        schema: PROPERTY_TEMPLATE,
      },
    ])
    .onConflictDoNothing();
  const allUsers = await db.select().from(users);
  const allTemplates = await db.select().from(templates);
  return { users: allUsers, templates: allTemplates };
}

export async function seedInspections(db: Db, opts: SeedOptions): Promise<number> {
  const rand = mulberry32(opts.seed ?? 2026);
  const now = opts.now ?? new Date();
  const { users: allUsers, templates: allTemplates } = await seedUsersAndTemplates(db);
  const assessors = allUsers.filter((u) => u.role === 'assessor');
  const byCity = (city: string) =>
    assessors.find((a) => DEMO_USERS.find((d) => d.email === a.email)?.city === city);
  const vehicleT = allTemplates.find((t) => t.type === 'vehicle');
  const propertyT = allTemplates.find((t) => t.type === 'property');
  if (!vehicleT || !propertyT || assessors.length === 0)
    throw new Error('seed prerequisites missing');

  const rows: (typeof inspections.$inferInsert)[] = [];
  for (let i = 0; i < opts.count; i++) {
    const place = pick(rand, PLACES);
    const isVehicle = rand() < 0.65;
    const template = isVehicle ? vehicleT : propertyT;
    const jitter = () => (rand() - 0.5) * 0.004; // a few hundred metres
    const houseNo = 1 + Math.floor(rand() * 240);
    const address: Address = {
      line1: `${houseNo} ${place.line1}`,
      suburb: place.suburb,
      city: place.city,
      province: place.province,
      postalCode: place.postalCode,
    };
    const subject: Subject = isVehicle
      ? (() => {
          const [make, model] = pick(rand, VEHICLES);
          return {
            kind: 'vehicle' as const,
            make,
            model,
            year: 2012 + Math.floor(rand() * 14),
            registration: registration(rand, place.province),
            colour: pick(rand, COLOURS),
          };
        })()
      : {
          kind: 'property' as const,
          propertyType: pick(rand, ['house', 'townhouse', 'apartment', 'commercial'] as const),
          erfNumber: String(1000 + Math.floor(rand() * 9000)),
        };

    // Demo: Johannesburg jobs go to Thandi, Gqeberha to Pieter, Durban stays with the manager to assign.
    const localAssessor = byCity(place.city);
    const unassigned = !opts.mixedStatuses && !localAssessor;
    const assigneeId = unassigned ? null : (localAssessor ?? pick(rand, assessors)).id;
    const status: InspectionStatus = opts.mixedStatuses
      ? pick(rand, [
          'assigned',
          'assigned',
          'in_progress',
          'submitted',
          'approved',
          'sent_back',
        ] as const)
      : 'assigned';
    const dueAt = new Date(now.getTime() + Math.floor((rand() * 4 - 0.5) * 86_400_000));
    dueAt.setUTCMinutes(0, 0, 0);
    const priority: Priority = pick(rand, [
      'low',
      'normal',
      'normal',
      'normal',
      'high',
      'urgent',
    ] as const);
    const name = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
    const updatedAt = new Date(now.getTime() - (opts.count - i) * 1000);

    rows.push({
      reference: `INS-${now.getUTCFullYear()}-${String(i + 1).padStart(5, '0')}`,
      templateId: template.id,
      templateVersion: template.version,
      assigneeId,
      claimNumber: `CLM-${100000 + Math.floor(rand() * 900000)}`,
      insuredName: name,
      insuredPhone: `0${pick(rand, ['82', '83', '72', '76', '61', '71'])}${String(Math.floor(rand() * 1e7)).padStart(7, '0')}`,
      sumInsuredCents: isVehicle
        ? (80_000 + Math.floor(rand() * 900_000)) * 100
        : (900_000 + Math.floor(rand() * 6_000_000)) * 100,
      subject,
      address,
      lat: place.lat + jitter(),
      lng: place.lng + jitter(),
      dueAt,
      priority,
      status,
      createdAt: updatedAt,
      updatedAt,
    });
  }

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(inspections)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing({ target: inspections.reference });
  }
  return rows.length;
}

export async function resetDatabase(db: Db) {
  await db.execute(sql`truncate table
    job_outbox, idempotency_keys, devices, reports, review_events, gps_points, damage_pins,
    signatures, inspection_photos, inspection_answers, inspections, templates, refresh_tokens, users
    restart identity cascade`);
}
