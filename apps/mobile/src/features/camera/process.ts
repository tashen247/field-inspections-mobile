import { Skia, ImageFormat, matchFont } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { watermarkLines } from './watermark';

export const MAX_EDGE = 1600;
export const MAX_BYTES = 500 * 1024;

export interface ProcessedPhoto {
  uri: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export function photoDir(inspectionId: string): Directory {
  const dir = new Directory(Paths.document, 'inspections', inspectionId, 'photos');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Scale so the long edge is at most MAX_EDGE, keeping the aspect ratio. */
export function targetSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= MAX_EDGE) return { width, height };
  const k = MAX_EDGE / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/**
 * Resize, burn in the GPS/time watermark, and compress under 500 KB. Runs entirely on the
 * device (Skia draws off-screen), and the final file lands in the app's document directory,
 * where it stays until the upload is confirmed.
 */
export async function processPhoto(opts: {
  sourceUri: string;
  sourceWidth: number;
  sourceHeight: number;
  inspectionId: string;
  photoId: string;
  takenAt: Date;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  caption: string;
}): Promise<ProcessedPhoto> {
  const size = targetSize(opts.sourceWidth, opts.sourceHeight);
  const resized = await ImageManipulator.manipulate(opts.sourceUri)
    .resize(size)
    .renderAsync()
    .then((ref) => ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 }));

  const src = new File(resized.uri);
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(await src.bytes()));
  if (!image) throw new Error('Could not decode the photo');
  const w = image.width();
  const h = image.height();
  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) throw new Error('Could not allocate an image surface');
  const canvas = surface.getCanvas();
  canvas.drawImage(image, 0, 0);

  const fontSize = Math.max(14, Math.round(w / 55));
  const font = matchFont({
    fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }),
    fontSize,
    fontWeight: '600',
  });
  const lines = watermarkLines({
    takenAt: opts.takenAt,
    lat: opts.lat,
    lng: opts.lng,
    accuracy: opts.accuracy,
    caption: opts.caption,
  });
  const pad = Math.round(fontSize * 0.6);
  const barH = lines.length * (fontSize + pad) + pad;
  const bar = Skia.Paint();
  bar.setColor(Skia.Color('rgba(0,0,0,0.55)'));
  canvas.drawRect(Skia.XYWHRect(0, h - barH, w, barH), bar);
  const ink = Skia.Paint();
  ink.setColor(Skia.Color('#FFFFFF'));
  lines.forEach((line, i) => {
    canvas.drawText(line, pad, h - barH + pad + fontSize * (i + 1) + pad * i * 0.6, ink, font);
  });
  surface.flush();
  const snapshot = surface.makeImageSnapshot();

  // Step quality down until the file fits the budget.
  let bytes = snapshot.encodeToBytes(ImageFormat.JPEG, 82);
  for (const q of [72, 62, 52, 42]) {
    if (bytes.length <= MAX_BYTES) break;
    bytes = snapshot.encodeToBytes(ImageFormat.JPEG, q);
  }

  const out = new File(photoDir(opts.inspectionId), `${opts.photoId}.jpg`);
  if (out.exists) out.delete();
  out.create();
  out.write(bytes);
  for (const tmp of [src, new File(opts.sourceUri)]) {
    try {
      if (tmp.exists && tmp.uri !== out.uri) tmp.delete();
    } catch {
      // temporary camera files are cleaned up by the OS eventually
    }
  }
  return { uri: out.uri, width: w, height: h, sizeBytes: bytes.length };
}
