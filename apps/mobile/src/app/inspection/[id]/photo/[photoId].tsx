import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';
import { Button, Card, EmptyState, Screen, Text } from '../../../../components/ui';
import { deletePhoto, getJob } from '../../../../db/repo';
import { photos } from '../../../../db/schema';
import { useDbQuery } from '../../../../lib/use-db';
import { getServices } from '../../../../services';
import { eq } from 'drizzle-orm';

export default function PhotoViewer() {
  const { id, photoId } = useLocalSearchParams<{ id: string; photoId: string }>();
  const s = useDbQuery(
    (db) => ({
      photo: db.select().from(photos).where(eq(photos.id, photoId)).get(),
      editable: getJob(db, id)?.localState === 'working',
    }),
    [id, photoId],
  );
  if (!s.photo)
    return (
      <Screen>
        <EmptyState icon="image-outline" title="Photo removed" />
      </Screen>
    );
  const p = s.photo;
  return (
    <Screen scroll>
      <View style={{ aspectRatio: p.width / p.height, borderRadius: 12, overflow: 'hidden' }}>
        <Image
          source={{ uri: p.fileUri }}
          style={{ flex: 1 }}
          contentFit="contain"
          accessibilityLabel="Inspection photo"
        />
      </View>
      <Card>
        <Text variant="label">
          {p.shotKey ? `Guided shot: ${p.shotKey.replace(/_/g, ' ')}` : 'Extra photo'}
        </Text>
        <Text variant="muted">Taken {new Date(p.takenAt).toLocaleString('en-ZA')}</Text>
        <Text variant="muted">
          {p.width}×{p.height} · {Math.round(p.sizeBytes / 1024)} KB
          {p.lat !== null && p.lng !== null ? ` · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : ''}
        </Text>
        <Text variant="caption">Upload: {p.uploadState}</Text>
      </Card>
      {s.editable ? (
        <Button
          title="Delete photo"
          variant="danger"
          icon="trash-outline"
          onPress={() =>
            Alert.alert('Delete this photo?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  const row = deletePhoto(getServices().db, p.id);
                  if (row) {
                    const f = new File(row.fileUri);
                    if (f.exists) f.delete();
                  }
                  router.back();
                },
              },
            ])
          }
        />
      ) : null}
    </Screen>
  );
}
