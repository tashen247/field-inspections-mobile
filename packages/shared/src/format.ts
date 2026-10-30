import type { LatLng } from './inspection.js';

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. Used on the device; the API uses PostGIS. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '–';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Formats South African cents as rand, e.g. 12345600 -> "R 123 456.00". */
export function formatZar(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const rands = Math.floor(abs / 100);
  const c = String(abs % 100).padStart(2, '0');
  const grouped = String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '-' : ''}R ${grouped}.${c}`;
}
