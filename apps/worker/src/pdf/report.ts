import {
  INSPECTION_STATUS_LABELS,
  flattenItems,
  formatAddress,
  formatDistance,
  formatZar,
  haversineMeters,
  type AnswerValue,
  type ChecklistItem,
} from '@fim/shared';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import type { ReportData } from '../report-data.js';

const A4 = { w: 595.28, h: 841.89 };
const M = 42; // margin
const TEAL = rgb(0.055, 0.486, 0.525);
const INK = rgb(0.09, 0.13, 0.17);
const MUTED = rgb(0.38, 0.44, 0.5);
const LINE = rgb(0.85, 0.88, 0.91);
const PASS = rgb(0.18, 0.52, 0.25);
const FAIL = rgb(0.78, 0.22, 0.18);
const SEVERITY: Record<string, RGB> = {
  minor: rgb(0.91, 0.77, 0.28),
  moderate: rgb(0.91, 0.64, 0.09),
  severe: rgb(0.9, 0.33, 0.29),
};

/** Standard PDF fonts only cover Windows-1252; replace anything else so drawing never throws. */
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export function safe(text: string): string {
  let out = '';
  for (const ch of text.replace(/\u2192/g, '->')) {
    const code = ch.codePointAt(0)!;
    if (code === 0x2009 || code === 0x202f) out += ' ';
    else if (code <= 0xff || CP1252_EXTRA.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

const fmtDate = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat('en-ZA', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Johannesburg',
      }).format(d)
    : '-';

function answerText(item: ChecklistItem, value: AnswerValue | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  if (item.kind === 'passFail')
    return value === 'pass' ? 'Pass' : value === 'fail' ? 'Fail' : 'N/A';
  if (item.kind === 'select')
    return item.options.find((o) => o.value === value)?.label ?? String(value);
  if (item.kind === 'number') {
    if (item.unit === 'ZAR' && typeof value === 'number') return formatZar(value * 100);
    return `${value}${item.unit ? ` ${item.unit}` : ''}`;
  }
  return String(value);
}

export interface ReportAssets {
  /** Photo bytes by photo id (JPEG); missing entries render as placeholders. */
  photos: Map<string, Uint8Array>;
  signature: Uint8Array | null;
  generatedAt: Date;
}

class Layout {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.pages.push(this.page);
    this.y = A4.h - M;
  }
  ensure(height: number) {
    if (this.y - height < M + 24) this.newPage();
  }
  text(
    t: string,
    opts: { x?: number; size?: number; bold?: boolean; color?: RGB; maxWidth?: number } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? M;
    const lines = wrap(t, font, size, opts.maxWidth ?? A4.w - x - M);
    for (const line of lines) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + 4;
    }
  }
  heading(t: string) {
    this.ensure(40);
    this.y -= 10;
    this.page.drawText(safe(t), { x: M, y: this.y - 14, size: 14, font: this.bold, color: TEAL });
    this.y -= 20;
    this.page.drawLine({
      start: { x: M, y: this.y },
      end: { x: A4.w - M, y: this.y },
      thickness: 1,
      color: TEAL,
    });
    this.y -= 8;
  }
  keyValues(rows: [string, string][], columns = 2) {
    const colW = (A4.w - 2 * M) / columns;
    for (let i = 0; i < rows.length; i += columns) {
      const chunk = rows.slice(i, i + columns);
      const heights = chunk.map(([, v]) => wrap(v, this.font, 10, colW - 12).length);
      const h = 12 + Math.max(...heights) * 13 + 6;
      this.ensure(h);
      chunk.forEach(([k, v], c) => {
        const x = M + c * colW;
        this.page.drawText(safe(k.toUpperCase()), {
          x,
          y: this.y - 8,
          size: 7,
          font: this.bold,
          color: MUTED,
        });
        wrap(v, this.font, 10, colW - 12).forEach((line, n) => {
          this.page.drawText(line, {
            x,
            y: this.y - 22 - n * 13,
            size: 10,
            font: this.font,
            color: INK,
          });
        });
      });
      this.y -= h;
    }
  }
}

/** Builds the PDF report. Pure: data in, bytes out, so it is easy to test and to run anywhere. */
export async function renderReportPdf(data: ReportData, assets: ReportAssets): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Inspection report ${data.reference}`);
  doc.setSubject(`${data.templateName} - ${data.insuredName}`);
  doc.setProducer('Field Inspections');
  doc.setCreator('Field Inspections');
  doc.setCreationDate(assets.generatedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = new Layout(doc, font, bold);

  // Header band
  L.page.drawRectangle({ x: 0, y: A4.h - 96, width: A4.w, height: 96, color: TEAL });
  L.page.drawText('INSPECTION REPORT', {
    x: M,
    y: A4.h - 44,
    size: 20,
    font: bold,
    color: rgb(1, 1, 1),
  });
  L.page.drawText(safe(`${data.reference}  ·  ${data.templateName}`), {
    x: M,
    y: A4.h - 66,
    size: 11,
    font,
    color: rgb(0.88, 0.97, 0.97),
  });
  const status = safe(INSPECTION_STATUS_LABELS[data.status].toUpperCase());
  const sw = bold.widthOfTextAtSize(status, 10) + 18;
  L.page.drawRectangle({
    x: A4.w - M - sw,
    y: A4.h - 52,
    width: sw,
    height: 20,
    color: rgb(1, 1, 1),
  });
  L.page.drawText(status, {
    x: A4.w - M - sw + 9,
    y: A4.h - 46,
    size: 10,
    font: bold,
    color: TEAL,
  });
  L.page.drawText(safe(`Generated ${fmtDate(assets.generatedAt)}`), {
    x: A4.w - M - 160,
    y: A4.h - 78,
    size: 8,
    font,
    color: rgb(0.88, 0.97, 0.97),
  });
  L.y = A4.h - 112;

  const subject =
    data.subject.kind === 'vehicle'
      ? `${data.subject.year ?? ''} ${data.subject.make} ${data.subject.model}`.trim() +
        ` · ${data.subject.registration}${data.subject.vin ? ` · VIN ${data.subject.vin}` : ''}`
      : `${data.subject.propertyType}${data.subject.erfNumber ? ` · Erf ${data.subject.erfNumber}` : ''}`;
  L.heading('Summary');
  L.keyValues([
    ['Insured', data.insuredName],
    ['Claim number', data.claimNumber ?? '-'],
    [data.subject.kind === 'vehicle' ? 'Vehicle' : 'Property', subject],
    ['Insured value', data.sumInsuredCents !== null ? formatZar(data.sumInsuredCents) : '-'],
    ['Assessor', data.assessorName ?? '-'],
    ['Priority', data.priority],
    ['Address', formatAddress(data.address)],
    ['Coordinates', `${data.location.lat.toFixed(5)}, ${data.location.lng.toFixed(5)}`],
  ]);

  // Timing and location evidence
  let travelled = 0;
  for (let i = 1; i < data.gps.length; i++)
    travelled += haversineMeters(data.gps[i - 1]!, data.gps[i]!);
  L.heading('On-site evidence');
  L.keyValues([
    ['Started', fmtDate(data.startedAt)],
    ['Completed', fmtDate(data.completedAt)],
    ['Submitted', fmtDate(data.submittedAt)],
    ['Due', fmtDate(data.dueAt)],
    [
      'Distance from address at start',
      data.startDistanceM === null
        ? 'Not recorded'
        : `${formatDistance(data.startDistanceM)}${data.startDistanceM > 200 ? ' (outside 200 m geofence)' : ' (within geofence)'}`,
    ],
    [
      'GPS trail',
      data.gps.length ? `${data.gps.length} points, ${formatDistance(travelled)} covered` : 'None',
    ],
  ]);

  // Checklist
  L.heading('Checklist');
  const fails = flattenItems(data.template).filter(
    ({ item }) => data.answers.get(item.key)?.value === 'fail',
  );
  if (fails.length) {
    L.text(
      `${fails.length} item${fails.length === 1 ? '' : 's'} failed: ${fails.map((f) => f.item.label).join(', ')}`,
      {
        color: FAIL,
        bold: true,
      },
    );
    L.y -= 4;
  }
  const labelW = 250;
  for (const section of data.template.sections) {
    L.ensure(30);
    L.y -= 4;
    L.text(section.title, { bold: true, size: 11, color: TEAL });
    for (const item of section.items) {
      const a = data.answers.get(item.key);
      const value = answerText(item, a?.value);
      const valueW = A4.w - 2 * M - labelW - 12;
      const labelLines = wrap(item.label, font, 9.5, labelW);
      const valueLines = wrap(value, bold, 9.5, valueW);
      const noteLines = a?.note ? wrap(a.note, font, 8.5, valueW) : [];
      const h =
        Math.max(labelLines.length * 12, valueLines.length * 12 + noteLines.length * 11) + 6;
      L.ensure(h);
      labelLines.forEach((line, n) =>
        L.page.drawText(line, { x: M, y: L.y - 10 - n * 12, size: 9.5, font, color: INK }),
      );
      const color = a?.value === 'pass' ? PASS : a?.value === 'fail' ? FAIL : INK;
      valueLines.forEach((line, n) =>
        L.page.drawText(line, {
          x: M + labelW + 12,
          y: L.y - 10 - n * 12,
          size: 9.5,
          font: bold,
          color,
        }),
      );
      const noteTop = L.y - 10 - valueLines.length * 12;
      noteLines.forEach((line, n) =>
        L.page.drawText(line, {
          x: M + labelW + 12,
          y: noteTop - n * 11,
          size: 8.5,
          font,
          color: MUTED,
        }),
      );
      L.y -= h;
      L.page.drawLine({
        start: { x: M, y: L.y + 2 },
        end: { x: A4.w - M, y: L.y + 2 },
        thickness: 0.5,
        color: LINE,
      });
    }
  }

  // Damage markup
  if (data.pins.length) {
    L.heading(`Damage (${data.pins.length})`);
    const diagram = data.pins[0]!.diagram;
    const box =
      diagram === 'vehicle-top' ? { w: 100, h: 182, s: 1.25 } : { w: 140, h: 100, s: 2.2 };
    const dw = box.w * box.s;
    const dh = box.h * box.s;
    L.ensure(dh + 10);
    const ox = M;
    const oy = L.y; // top-left of the diagram
    const svgPaths =
      diagram === 'vehicle-top'
        ? [
            'M30 6 Q50 0 70 6 Q86 12 88 34 L90 150 Q88 172 70 177 Q50 182 30 177 Q12 172 10 150 L12 34 Q14 12 30 6 Z',
            'M22 50 Q50 40 78 50 L74 72 Q50 66 26 72 Z',
            'M26 128 Q50 134 74 128 L78 146 Q50 154 22 146 Z',
            'M26 74 L74 74 L74 126 L26 126 Z',
          ]
        : [
            'M4 4 L136 4 L136 96 L4 96 Z',
            'M52 4 L52 60',
            'M4 60 L136 60',
            'M92 4 L92 60',
            'M72 60 L72 96',
            'M110 60 L110 96',
          ];
    for (const p of svgPaths) {
      L.page.drawSvgPath(p, { x: ox, y: oy, scale: box.s, borderColor: MUTED, borderWidth: 1 });
    }
    data.pins.forEach((pin, n) => {
      const cx = ox + pin.x * dw;
      const cy = oy - pin.y * dh;
      L.page.drawCircle({
        x: cx,
        y: cy,
        size: 8,
        color: SEVERITY[pin.severity] ?? FAIL,
        borderColor: INK,
        borderWidth: 0.5,
      });
      const label = String(n + 1);
      L.page.drawText(label, {
        x: cx - bold.widthOfTextAtSize(label, 8) / 2,
        y: cy - 3,
        size: 8,
        font: bold,
        color: INK,
      });
    });
    // Legend beside the diagram
    const lx = ox + dw + 24;
    let ly = oy - 4;
    data.pins.forEach((pin, n) => {
      const lines = wrap(
        `${n + 1}. ${pin.severity.toUpperCase()}${pin.note ? ` - ${pin.note}` : ''}`,
        font,
        9,
        A4.w - M - lx,
      );
      for (const line of lines) {
        L.page.drawText(line, { x: lx, y: ly - 9, size: 9, font, color: INK });
        ly -= 12;
      }
      ly -= 3;
    });
    L.y = Math.min(oy - dh, ly) - 10;
  }

  // Photos, two per row
  if (data.photos.length) {
    L.heading(`Photos (${data.photos.length})`);
    const items = new Map(flattenItems(data.template).map(({ item }) => [item.key, item]));
    const cellW = (A4.w - 2 * M - 16) / 2;
    const imgH = 170;
    for (let i = 0; i < data.photos.length; i += 2) {
      L.ensure(imgH + 40);
      for (let c = 0; c < 2; c++) {
        const p = data.photos[i + c];
        if (!p) continue;
        const x = M + c * (cellW + 16);
        const bytes = assets.photos.get(p.id);
        let img: PDFImage | null = null;
        try {
          img = bytes ? await doc.embedJpg(bytes) : null;
        } catch {
          img = null;
        }
        if (img) {
          const k = Math.min(cellW / img.width, imgH / img.height);
          const w = img.width * k;
          const h = img.height * k;
          L.page.drawImage(img, {
            x: x + (cellW - w) / 2,
            y: L.y - imgH + (imgH - h) / 2,
            width: w,
            height: h,
          });
        } else {
          L.page.drawRectangle({
            x,
            y: L.y - imgH,
            width: cellW,
            height: imgH,
            borderColor: LINE,
            borderWidth: 1,
          });
          L.page.drawText('Photo not available', {
            x: x + 12,
            y: L.y - imgH / 2,
            size: 9,
            font,
            color: MUTED,
          });
        }
        const item = items.get(p.itemKey);
        const shot = item?.shots.find((s) => s.key === p.shotKey);
        L.page.drawText(safe(`${shot?.label ?? item?.label ?? p.itemKey}`), {
          x,
          y: L.y - imgH - 12,
          size: 9,
          font: bold,
          color: INK,
        });
        L.page.drawText(
          safe(
            `${fmtDate(p.takenAt)}${p.lat !== null && p.lng !== null ? ` · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : ''}`,
          ),
          { x, y: L.y - imgH - 24, size: 8, font, color: MUTED },
        );
      }
      L.y -= imgH + 36;
    }
  }

  // Signature
  if (data.signature) {
    L.heading('Client signature');
    L.ensure(110);
    let drawn = false;
    if (assets.signature) {
      try {
        const sig = await doc.embedPng(assets.signature);
        const k = Math.min(220 / sig.width, 80 / sig.height);
        L.page.drawImage(sig, {
          x: M,
          y: L.y - sig.height * k,
          width: sig.width * k,
          height: sig.height * k,
        });
        L.y -= sig.height * k + 6;
        drawn = true;
      } catch {
        drawn = false;
      }
    }
    if (!drawn) L.text('Signature image not available', { color: MUTED });
    L.text(`${data.signature.signedName} · ${fmtDate(data.signature.signedAt)}`, { size: 9 });
  }

  // Audit trail
  L.heading('Audit trail');
  for (const e of data.events) {
    L.text(
      `${fmtDate(e.createdAt)}  ${e.kind.replace('_', ' ')}${e.actorName ? ` by ${e.actorName}` : ''}${e.comment ? ` - "${e.comment}"` : ''}`,
      { size: 9 },
    );
  }

  // Footer on every page
  L.pages.forEach((page, n) => {
    const text = safe(`${data.reference} · Page ${n + 1} of ${L.pages.length}`);
    page.drawLine({
      start: { x: M, y: 34 },
      end: { x: A4.w - M, y: 34 },
      thickness: 0.5,
      color: LINE,
    });
    page.drawText(text, {
      x: A4.w - M - font.widthOfTextAtSize(text, 8),
      y: 22,
      size: 8,
      font,
      color: MUTED,
    });
    page.drawText('Field Inspections', { x: M, y: 22, size: 8, font, color: MUTED });
  });

  return doc.save();
}
