import { Directory, File, Paths } from 'expo-file-system';

function dir(): Directory {
  const d = new Directory(Paths.document, 'reference');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export function referenceImageFile(name: string): File {
  return new File(dir(), `${name}.svg`);
}

/** Downloads any reference images not yet on the device. */
export async function cacheReferenceImages(baseUrl: string, names: string[]) {
  await Promise.all(
    names.map(async (name) => {
      const file = referenceImageFile(name);
      if (file.exists) return;
      await File.downloadFileAsync(`${baseUrl}/v1/reference-images/${name}.svg`, file).catch(
        () => undefined,
      );
    }),
  );
}
