const pad = (n: number) => String(n).padStart(2, '0');

/** Text burned into the bottom of every photo, so the evidence travels with the image. */
export function watermarkLines(opts: {
  takenAt: Date;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  caption: string;
}): string[] {
  const d = opts.takenAt;
  // SAST is UTC+2 all year (no daylight saving), so the stamp is unambiguous for reviewers.
  const sast = new Date(d.getTime() + 2 * 3_600_000);
  const stamp = `${sast.getUTCFullYear()}-${pad(sast.getUTCMonth() + 1)}-${pad(sast.getUTCDate())} ${pad(sast.getUTCHours())}:${pad(sast.getUTCMinutes())}:${pad(sast.getUTCSeconds())} SAST`;
  const gps =
    opts.lat !== null && opts.lng !== null
      ? `${Math.abs(opts.lat).toFixed(5)}°${opts.lat < 0 ? 'S' : 'N'} ${Math.abs(opts.lng).toFixed(5)}°${opts.lng < 0 ? 'W' : 'E'}${opts.accuracy !== null ? ` ±${Math.round(opts.accuracy)} m` : ''}`
      : 'GPS unavailable';
  return [opts.caption, `${stamp} · ${gps}`];
}
