import { Ionicons } from '@expo/vector-icons';
import { INSPECTION_STATUS_LABELS, formatAddress, type ConflictDetails } from '@fim/shared';
import { View } from 'react-native';
import { Button, Card, Row, Text } from '../../components/ui';
import { useTheme } from '../../theme';

export interface ConflictViewProps {
  details: ConflictDetails;
  /** What would be thrown away by discarding, e.g. "14 answers, 9 photos, signature". */
  localSummary: string;
  onResubmit: () => void;
  onDiscard: () => void;
  onLater: () => void;
}

const COPY = {
  modified: {
    title: 'Your manager changed this job',
    body: 'The job was updated after you downloaded it. Your answers and photos are still on this device. You can send them against the latest version, or discard them.',
  },
  reassigned: {
    title: 'This job was reassigned',
    body: 'It now belongs to another assessor, so your work cannot be submitted. Let your manager know if you already finished it.',
  },
  closed: {
    title: 'This job is already closed',
    body: 'It was submitted or approved from somewhere else, so your copy cannot be sent.',
  },
} as const;

/** Never overwrite silently: show what changed and let the assessor choose. */
export function ConflictView({
  details,
  localSummary,
  onResubmit,
  onDiscard,
  onLater,
}: ConflictViewProps) {
  const t = useTheme();
  const c = details.current;
  const copy = COPY[details.reason];
  return (
    <View style={{ gap: 12 }} testID="conflict-view">
      <Card style={{ borderColor: t.colors.danger }}>
        <Row>
          <Ionicons name="warning" size={24} color={t.colors.danger} />
          <Text variant="heading" style={{ flex: 1 }}>
            {copy.title}
          </Text>
        </Row>
        <Text>{copy.body}</Text>
      </Card>

      <Card>
        <Text variant="label">On the server now</Text>
        <Text variant="muted">
          {c.reference} · {INSPECTION_STATUS_LABELS[c.status]} · version {c.version} (you had{' '}
          {details.baseVersion})
        </Text>
        {details.reason === 'reassigned' ? (
          <Text variant="muted">Assigned to {c.assigneeName ?? 'nobody yet'}</Text>
        ) : null}
        <Text variant="muted">
          Due{' '}
          {new Date(c.dueAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
        </Text>
        <Text variant="muted">{formatAddress(c.address)}</Text>
      </Card>

      <Card>
        <Text variant="label">On this device</Text>
        <Text variant="muted">{localSummary}</Text>
      </Card>

      {details.reason === 'modified' ? (
        <Button
          title="Send my work on the latest version"
          icon="cloud-upload-outline"
          onPress={onResubmit}
        />
      ) : null}
      <Button
        title="Discard my work on this device"
        variant="danger"
        icon="trash-outline"
        onPress={onDiscard}
      />
      <Button title="Decide later" variant="ghost" onPress={onLater} />
    </View>
  );
}
