/**
 * Line-drawing reference images for guided shots ("frame the car like this"). They are tiny
 * SVGs so the app can cache every one of them for offline use with a single sync.
 */
const W = 240;
const H = 160;
const STROKE = '#0E7C86';
const HIGHLIGHT = '#E8A317';

const frame = (body: string, caption: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
  `<rect width="${W}" height="${H}" rx="12" fill="#F4F8F9"/>` +
  `<g fill="none" stroke="${STROKE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</g>` +
  `<text x="${W / 2}" y="${H - 10}" font-family="sans-serif" font-size="13" fill="#24414A" text-anchor="middle">${caption}</text>` +
  `</svg>`;

/** Three-quarter car outline; `mirror` flips it, `rear` swaps which end faces the camera. */
function carAngle(mirror: boolean, rear: boolean, caption: string) {
  const t = mirror ? `translate(${W},0) scale(-1,1)` : '';
  const nose = rear
    ? '<path d="M38 96 L38 78 L52 74" stroke="' +
      HIGHLIGHT +
      '"/><rect x="40" y="82" width="14" height="6" stroke="' +
      HIGHLIGHT +
      '"/>'
    : '<path d="M38 96 L36 80 L56 72" stroke="' +
      HIGHLIGHT +
      '"/><circle cx="46" cy="84" r="5" stroke="' +
      HIGHLIGHT +
      '"/>';
  return frame(
    `<g transform="${t}">` +
      '<path d="M36 100 L36 82 Q40 72 60 70 L84 50 Q92 44 110 44 L160 44 Q176 44 186 56 L198 70 Q210 74 210 86 L210 100 Z"/>' +
      '<path d="M90 52 L110 50 L110 70 L76 70 Z M118 50 L158 50 Q170 52 180 68 L118 70 Z"/>' +
      '<circle cx="74" cy="102" r="14"/><circle cx="178" cy="102" r="14"/>' +
      nose +
      '</g>',
    caption,
  );
}

const IMAGES: Record<string, () => string> = {
  front_left: () => carAngle(false, false, 'Front-left: bonnet and left side in frame'),
  front_right: () => carAngle(true, false, 'Front-right: bonnet and right side in frame'),
  rear_left: () => carAngle(true, true, 'Rear-left: boot and left side in frame'),
  rear_right: () => carAngle(false, true, 'Rear-right: boot and right side in frame'),
  vin_plate: () =>
    frame(
      '<rect x="40" y="40" width="160" height="56" rx="6"/>' +
        `<text x="120" y="76" font-family="monospace" font-size="18" fill="${STROKE}" stroke="none" text-anchor="middle">AHT•••••••••1234</text>`,
      'VIN plate: fill the frame, all 17 characters sharp',
    ),
  odometer: () =>
    frame(
      '<path d="M50 110 A70 70 0 0 1 190 110"/><path d="M120 110 L160 70" stroke="' +
        HIGHLIGHT +
        '"/>' +
        `<rect x="88" y="84" width="64" height="20" rx="3"/><text x="120" y="99" font-family="monospace" font-size="14" fill="${STROKE}" stroke="none" text-anchor="middle">123456</text>`,
      'Odometer: ignition on, digits readable',
    ),
  licence_disc: () =>
    frame(
      '<rect x="30" y="30" width="180" height="90" rx="10"/><circle cx="170" cy="62" r="24" stroke="' +
        HIGHLIGHT +
        '"/>',
      'Licence disc: expiry date readable through the glass',
    ),
  street_view: () =>
    frame(
      '<path d="M40 110 L40 64 L120 30 L200 64 L200 110 Z"/><rect x="104" y="78" width="32" height="32"/>' +
        `<rect x="150" y="70" width="30" height="18" stroke="${HIGHLIGHT}"/><text x="165" y="84" font-family="sans-serif" font-size="12" fill="${HIGHLIGHT}" stroke="none" text-anchor="middle">24</text>`,
      'Street view: whole front with the house number visible',
    ),
  roof: () =>
    frame(
      `<path d="M30 70 L120 26 L210 70" stroke="${HIGHLIGHT}" stroke-width="5"/><path d="M50 70 L50 116 L190 116 L190 70"/>`,
      'Roof: from a distance, whole roofline in frame',
    ),
  geyser: () =>
    frame(
      '<rect x="80" y="26" width="80" height="80" rx="40"/><path d="M70 112 L170 112 L170 120 L70 120 Z" stroke="' +
        HIGHLIGHT +
        '"/>',
      'Geyser: include the drip tray and pipes',
    ),
};

export const REFERENCE_IMAGE_NAMES = Object.keys(IMAGES);

export function referenceImageSvg(name: string): string | null {
  const make = IMAGES[name];
  return make ? make() : null;
}
