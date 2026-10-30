import { Ionicons } from '@expo/vector-icons';
import {
  INSPECTION_STATUS_LABELS,
  formatAddress,
  formatDistance,
  propertyTypeLabel,
  type Inspection,
} from '@fim/shared';
import * as Haptics from 'expo-haptics';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Badge, Card, Row, Text } from '../../components/ui';
import type { LocalState } from '../../db/schema';
import { priorityColor, statusColor, useTheme } from '../../theme';

const THRESHOLD = 110;

const LOCAL_LABEL: Partial<
  Record<
    LocalState,
    {
      label: string;
      icon: 'cloud-upload-outline' | 'sync' | 'warning' | 'cloud-done-outline' | 'create-outline';
    }
  >
> = {
  working: { label: 'In progress on device', icon: 'create-outline' },
  queued: { label: 'Waiting to sync', icon: 'cloud-upload-outline' },
  syncing: { label: 'Syncing', icon: 'sync' },
  synced: { label: 'Synced', icon: 'cloud-done-outline' },
  conflict: { label: 'Needs your decision', icon: 'warning' },
};

export interface JobCardProps {
  job: Inspection;
  localState: LocalState;
  distanceMeters: number | null;
  /** Label for the swipe action, e.g. "Start" or "Submit". Null disables swiping. */
  swipeLabel: string | null;
  onSwipe?: () => void;
  onPress: () => void;
}

/** A job row. Swipe left past the threshold to run its main action (start or submit). */
export function JobCard({
  job,
  localState,
  distanceMeters,
  swipeLabel,
  onSwipe,
  onPress,
}: JobCardProps) {
  const t = useTheme();
  const x = useSharedValue(0);
  const armed = useSharedValue(false);

  const fire = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSwipe?.();
  };
  const tick = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  const pan = Gesture.Pan()
    .enabled(!!swipeLabel)
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      x.value = Math.min(0, e.translationX);
      const nowArmed = -x.value > THRESHOLD;
      if (nowArmed !== armed.value) {
        armed.value = nowArmed;
        scheduleOnRN(tick);
      }
    })
    .onEnd(() => {
      if (armed.value) {
        x.value = withTiming(-400, { duration: 180 }, () => {
          scheduleOnRN(fire);
          x.value = withSpring(0);
        });
      } else {
        x.value = withSpring(0);
      }
      armed.value = false;
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const actionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-x.value, [0, THRESHOLD], [0, 1]),
    transform: [{ scale: interpolate(-x.value, [0, THRESHOLD], [0.7, 1], 'clamp') }],
  }));

  const due = new Date(job.dueAt);
  const overdue =
    due.getTime() < Date.now() && ['assigned', 'in_progress', 'sent_back'].includes(job.status);
  const local = LOCAL_LABEL[localState];
  const subject =
    job.subject.kind === 'vehicle'
      ? `${job.subject.make} ${job.subject.model} · ${job.subject.registration}`
      : `${propertyTypeLabel(job.subject.propertyType)}${job.subject.erfNumber ? ` · Erf ${job.subject.erfNumber}` : ''}`;

  return (
    <View>
      {swipeLabel ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.actionBg,
            { backgroundColor: t.colors.primary, borderRadius: t.radius.lg },
          ]}
        >
          <Animated.View style={[styles.action, actionStyle]}>
            <Ionicons name="arrow-forward-circle" size={26} color={t.colors.primaryText} />
            <Text color={t.colors.primaryText} style={{ fontWeight: '700' }}>
              {swipeLabel}
            </Text>
          </Animated.View>
        </View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={cardStyle}>
          <Card
            onPress={onPress}
            accessibilityLabel={`${job.reference}, ${job.insuredName}, ${formatAddress(job.address)}, ${INSPECTION_STATUS_LABELS[job.status]}${swipeLabel ? `. Swipe left to ${swipeLabel.toLowerCase()}` : ''}`}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <View style={[styles.dot, { backgroundColor: priorityColor[job.priority] }]} />
                <Text variant="label">{job.reference}</Text>
              </Row>
              <Badge label={INSPECTION_STATUS_LABELS[job.status]} color={statusColor[job.status]} />
            </Row>
            <Text variant="heading" numberOfLines={1}>
              {job.insuredName}
            </Text>
            <Text variant="muted" numberOfLines={1}>
              {subject}
            </Text>
            <Row>
              <Ionicons name="location-outline" size={14} color={t.colors.textMuted} />
              <Text variant="muted" numberOfLines={1} style={{ flex: 1 }}>
                {formatAddress(job.address)}
              </Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={overdue ? t.colors.danger : t.colors.textMuted}
                />
                <Text variant="caption" color={overdue ? t.colors.danger : undefined}>
                  {overdue ? 'Overdue · ' : 'Due '}
                  {due.toLocaleString('en-ZA', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </Row>
              {distanceMeters !== null ? (
                <Text variant="caption">{formatDistance(distanceMeters)} away</Text>
              ) : null}
            </Row>
            {local ? (
              <Row>
                <Ionicons
                  name={local.icon}
                  size={14}
                  color={localState === 'conflict' ? t.colors.danger : t.colors.primary}
                />
                <Text
                  variant="caption"
                  color={localState === 'conflict' ? t.colors.danger : t.colors.primary}
                >
                  {local.label}
                </Text>
              </Row>
            ) : null}
          </Card>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 5 },
  actionBg: { alignItems: 'flex-end', justifyContent: 'center', paddingRight: 24 },
  action: { alignItems: 'center', gap: 2 },
});
