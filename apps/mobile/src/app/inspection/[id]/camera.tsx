import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '../../../components/ui';
import { addPhoto, getJob, getTemplate, listPhotos } from '../../../db/repo';
import { processPhoto } from '../../../features/camera/process';
import { shotPlan } from '../../../features/camera/shots';
import { useDbQuery } from '../../../lib/use-db';
import { uuid } from '../../../lib/uuid';
import { getServices } from '../../../services';

export default function GuidedCamera() {
  const { id, itemKey, shotKey } = useLocalSearchParams<{
    id: string;
    itemKey: string;
    shotKey?: string;
  }>();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useDbQuery(
    (db) => {
      const job = getJob(db, id);
      const template = job ? getTemplate(db, job.data.templateId) : undefined;
      if (!job || !template) return null;
      const p = shotPlan(template.schema, itemKey, shotKey || null, listPhotos(db, id));
      return p ? { ...p, reference: job.data.reference } : null;
    },
    [id, itemKey, shotKey],
  );

  if (!permission) return <View style={styles.black} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.black, styles.center]}>
        <Ionicons name="camera-outline" size={56} color="#fff" />
        <Text color="#fff" style={{ textAlign: 'center' }}>
          Camera access is needed to take inspection photos.
        </Text>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }
  if (!plan) return <View style={styles.black} />;

  const capture = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const takenAt = new Date();
      const [shot, pos] = await Promise.all([
        camera.current.takePictureAsync({ quality: 0.9, shutterSound: true }),
        Location.getLastKnownPositionAsync({ maxAge: 60_000 }).catch(() => null),
      ]);
      const photoId = uuid();
      const caption = `${plan.reference} · ${plan.label}`;
      const processed = await processPhoto({
        sourceUri: shot.uri,
        sourceWidth: shot.width,
        sourceHeight: shot.height,
        inspectionId: id,
        photoId,
        takenAt,
        lat: pos?.coords.latitude ?? null,
        lng: pos?.coords.longitude ?? null,
        accuracy: pos?.coords.accuracy ?? null,
        caption,
      });
      // The photo row is written as soon as the file exists; from here it survives anything.
      addPhoto(getServices().db, {
        id: photoId,
        inspectionId: id,
        itemKey,
        shotKey: plan.current?.key ?? null,
        fileUri: processed.uri,
        takenAt: takenAt.toISOString(),
        lat: pos?.coords.latitude ?? null,
        lng: pos?.coords.longitude ?? null,
        width: processed.width,
        height: processed.height,
        sizeBytes: processed.sizeBytes,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFlash(true);
      setTimeout(() => setFlash(false), 350);
      if (plan.current && plan.next) {
        router.setParams({ shotKey: plan.next.key });
      } else if (plan.current) {
        router.back();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take the photo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.black}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        animateShutter={false}
      />
      {/* Framing guide */}
      <View pointerEvents="none" style={styles.guide} />
      {flash ? <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.flash} /> : null}
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close camera"
            onPress={() => router.back()}
            hitSlop={12}
          >
            <Ionicons name="close" size={30} color="#fff" />
          </Pressable>
          <Animated.View key={plan.label} entering={ZoomIn} style={styles.labelPill}>
            <Text color="#fff" style={{ fontWeight: '700' }}>
              {plan.label}
            </Text>
          </Animated.View>
          <View style={{ width: 30 }} />
        </View>
        {plan.hint ? (
          <Text color="#fff" style={styles.hint}>
            {plan.hint}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {error ? (
          <Text color="#ffb4ae" style={styles.hint}>
            {error}
          </Text>
        ) : null}
        <View style={styles.bottomBar}>
          <Text color="#fff" variant="caption" style={{ width: 90 }}>
            {plan.remainingRequired > 0 ? `${plan.remainingRequired} required left` : ''}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Take ${plan.label} photo`}
            onPress={() => void capture()}
            disabled={busy}
            style={({ pressed }) => [
              styles.shutter,
              { transform: [{ scale: pressed ? 0.92 : 1 }] },
            ]}
          >
            {busy ? <ActivityIndicator color="#0E7C86" /> : <View style={styles.shutterInner} />}
          </Pressable>
          <View style={{ width: 90, alignItems: 'flex-end' }}>
            {plan.next ? (
              <Text color="#fff" variant="caption" numberOfLines={2}>
                Next: {plan.next.label}
              </Text>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => router.back()}>
                <Text color="#fff" style={{ fontWeight: '700' }}>
                  Done
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  overlay: { ...StyleSheet.absoluteFill, padding: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelPill: {
    backgroundColor: 'rgba(14,124,134,0.85)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  hint: { textAlign: 'center', marginTop: 10, textShadowColor: '#000', textShadowRadius: 4 },
  guide: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    top: '22%',
    bottom: '26%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 16,
    borderStyle: 'dashed',
  },
  flash: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(255,255,255,0.6)' },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
});
