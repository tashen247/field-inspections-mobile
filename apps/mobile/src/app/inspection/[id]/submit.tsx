import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Badge, Button, Card, Row, Screen, Text } from '../../../components/ui';
import { getDraft, getJob, listGps, listPhotos, listPins } from '../../../db/repo';
import { submitInspection } from '../../../features/inspection/actions';
import { useDbQuery } from '../../../lib/use-db';
import { draftIssues } from '../../../sync/submission';
import { useTheme } from '../../../theme';

export default function SubmitScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [busy, setBusy] = useState(false);
  const s = useDbQuery(
    (db) => {
      const draft = getDraft(db, id);
      return {
        job: getJob(db, id),
        draft,
        issues: draftIssues(db, id),
        photos: listPhotos(db, id).length,
        pins: listPins(db, id).length,
        gps: listGps(db, id).length,
      };
    },
    [id],
  );
  if (!s.job || !s.draft) return null;

  const submit = () => {
    setBusy(true);
    const res = submitInspection(id);
    setBusy(false);
    if (res.ok) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.dismissTo('/(assessor)/jobs');
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      router.push({ pathname: '/inspection/[id]/checklist', params: { id, showIssues: '1' } });
    }
  };

  return (
    <Screen scroll>
      <Card>
        <Text variant="heading">{s.job.data.reference}</Text>
        <Text variant="muted">{s.job.data.insuredName}</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          <Badge label={`${s.photos} photos`} color={t.colors.primary} icon="camera" />
          <Badge label={`${s.pins} damage pins`} color={t.colors.primary} icon="locate" />
          <Badge label={`${s.gps} GPS points`} color={t.colors.primary} icon="navigate" />
          <Badge
            label={s.draft.signatureFileId ? `Signed by ${s.draft.signedName}` : 'No signature'}
            color={s.draft.signatureFileId ? t.colors.success : t.colors.danger}
            icon="create-outline"
          />
        </Row>
      </Card>
      {s.issues.length ? (
        <Card style={{ borderColor: t.colors.danger }}>
          <Row>
            <Ionicons name="alert-circle" size={20} color={t.colors.danger} />
            <Text variant="label">
              {s.issues.length} thing{s.issues.length === 1 ? '' : 's'} to finish
            </Text>
          </Row>
          {s.issues.slice(0, 8).map((i) => (
            <Text key={`${i.itemKey}-${i.kind}-${i.message}`} variant="muted">
              • {i.message}
            </Text>
          ))}
          {s.issues.some((i) => i.kind === 'signature_required') ? (
            <Button
              title="Capture signature"
              variant="secondary"
              icon="create-outline"
              onPress={() =>
                router.push({ pathname: '/inspection/[id]/signature', params: { id } })
              }
            />
          ) : null}
          <Button
            title="Go to checklist"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/inspection/[id]/checklist',
                params: { id, showIssues: '1' },
              })
            }
          />
        </Card>
      ) : (
        <Card>
          <Row>
            <Ionicons name="checkmark-circle" size={20} color={t.colors.success} />
            <Text variant="label">Ready to submit</Text>
          </Row>
          <Text variant="muted">
            Submitting locks the inspection on this device and sends it as soon as there is signal.
            Photos upload in the background, and nothing is lost if the app closes.
          </Text>
        </Card>
      )}
      <Button
        title="Submit inspection"
        icon="send"
        loading={busy}
        disabled={s.issues.length > 0}
        onPress={submit}
      />
    </Screen>
  );
}
