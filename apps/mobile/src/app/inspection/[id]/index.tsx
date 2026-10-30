import { Ionicons } from '@expo/vector-icons';
import {
  INSPECTION_STATUS_LABELS,
  checklistProgress,
  formatAddress,
  formatDistance,
  formatZar,
  propertyTypeLabel,
} from '@fim/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressBar,
  Row,
  Screen,
  Text,
} from '../../../components/ui';
import {
  getDraft,
  getJob,
  getTemplate,
  listAnswers,
  listOutbox,
  listPhotos,
  listPins,
} from '../../../db/repo';
import {
  beginInspection,
  checkStartPosition,
  useInspectionTracking,
} from '../../../features/inspection/actions';
import { openDirections } from '../../../lib/navigate';
import { useDbQuery } from '../../../lib/use-db';
import { getServices } from '../../../services';
import { reopenAfterSendBack } from '../../../sync/conflicts';
import { priorityColor, statusColor, useTheme } from '../../../theme';

export default function InspectionDetail() {
  const t = useTheme();
  const { id, autostart } = useLocalSearchParams<{ id: string; autostart?: string }>();
  const [starting, setStarting] = useState(false);
  const autoStarted = useRef(false);

  const state = useDbQuery(
    (db) => {
      const job = getJob(db, id);
      if (!job) return null;
      const draft = getDraft(db, id);
      const template = getTemplate(db, job.data.templateId);
      const answers = listAnswers(db, id);
      const ops = listOutbox(db, id);
      return {
        job,
        draft,
        template,
        progress: template
          ? checklistProgress(
              template.schema,
              answers.map((a) => ({ itemKey: a.itemKey, value: a.value ?? null })),
            )
          : null,
        photos: listPhotos(db, id).length,
        pins: listPins(db, id).length,
        opsDone: ops.filter((o) => o.status === 'done').length,
        opsTotal: ops.length,
      };
    },
    [id],
  );

  const working = state?.job.localState === 'working';
  useInspectionTracking(id, !!working);

  const start = async () => {
    if (!state) return;
    setStarting(true);
    try {
      const check = await checkStartPosition(state.job.data);
      const go = () => {
        beginInspection(state.job.data, check);
        router.push({ pathname: '/inspection/[id]/checklist', params: { id } });
      };
      if (check.withinGeofence) return go();
      Alert.alert(
        check.distanceMeters === null ? 'Location unavailable' : 'You are not at the address',
        check.distanceMeters === null
          ? 'We could not get a GPS fix. The start will be recorded without a location check.'
          : `You are ${formatDistance(check.distanceMeters)} from ${state.job.data.address.line1} (limit 200 m). Start anyway? The distance is recorded on the report.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Start anyway', onPress: go },
        ],
      );
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (autostart === '1' && state && !state.draft && !autoStarted.current) {
      autoStarted.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, state?.draft]);

  if (!state) {
    return (
      <Screen>
        <EmptyState
          icon="search"
          title="Job not on this device"
          message="It may have been reassigned."
        />
      </Screen>
    );
  }
  const { job, draft, progress } = state;
  const j = job.data;
  const open = j.status === 'assigned' || j.status === 'in_progress' || j.status === 'sent_back';

  return (
    <Screen scroll>
      {job.localState === 'conflict' ? (
        <Card style={{ borderColor: t.colors.danger }}>
          <Row>
            <Ionicons name="warning" size={20} color={t.colors.danger} />
            <Text variant="label" color={t.colors.danger}>
              This job changed while you were offline
            </Text>
          </Row>
          <Button
            title="Decide what to do"
            onPress={() => router.push({ pathname: '/inspection/[id]/conflict', params: { id } })}
          />
        </Card>
      ) : null}

      {j.status === 'sent_back' && j.reviewComment ? (
        <Card
          style={{
            borderColor: statusColor.sent_back,
            backgroundColor: `${statusColor.sent_back}11`,
          }}
        >
          <Row>
            <Ionicons name="return-up-back" size={18} color={statusColor.sent_back} />
            <Text variant="label">Sent back by your manager</Text>
          </Row>
          <Text>{j.reviewComment}</Text>
        </Card>
      ) : null}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label">{j.reference}</Text>
          <Row>
            <Badge label={j.priority.toUpperCase()} color={priorityColor[j.priority]} />
            <Badge label={INSPECTION_STATUS_LABELS[j.status]} color={statusColor[j.status]} />
          </Row>
        </Row>
        <Text variant="title">{j.insuredName}</Text>
        {j.subject.kind === 'vehicle' ? (
          <Text variant="muted">
            {j.subject.year ? `${j.subject.year} ` : ''}
            {j.subject.make} {j.subject.model} · {j.subject.registration}
            {j.subject.colour ? ` · ${j.subject.colour}` : ''}
          </Text>
        ) : (
          <Text variant="muted">
            {propertyTypeLabel(j.subject.propertyType)}
            {j.subject.erfNumber ? ` · Erf ${j.subject.erfNumber}` : ''}
          </Text>
        )}
        <Text variant="caption">
          Claim {j.claimNumber ?? '–'}
          {j.sumInsuredCents !== null ? ` · Insured value ${formatZar(j.sumInsuredCents)}` : ''}
        </Text>
        <Text variant="caption">
          Due{' '}
          {new Date(j.dueAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
        </Text>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <MapView
          style={{ height: 160 }}
          pointerEvents="none"
          initialRegion={{
            latitude: j.location.lat,
            longitude: j.location.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          <Marker coordinate={{ latitude: j.location.lat, longitude: j.location.lng }} />
        </MapView>
        <View style={{ padding: 16, gap: 10 }}>
          <Text>{formatAddress(j.address)}</Text>
          <Row>
            <Button
              style={{ flex: 1 }}
              variant="secondary"
              icon="navigate"
              title="Navigate"
              onPress={() => void openDirections(j.location, formatAddress(j.address))}
            />
            {j.insuredPhone ? (
              <Button
                style={{ flex: 1 }}
                variant="secondary"
                icon="call-outline"
                title="Call client"
                onPress={() => void Linking.openURL(`tel:${j.insuredPhone}`)}
              />
            ) : null}
          </Row>
        </View>
      </Card>

      {!draft && open ? (
        <Button
          title="Start inspection"
          icon="play"
          loading={starting}
          onPress={() => void start()}
        />
      ) : null}

      {draft && job.localState === 'working' && state.template ? (
        <>
          <Card
            onPress={() => router.push({ pathname: '/inspection/[id]/checklist', params: { id } })}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <Ionicons name="list" size={20} color={t.colors.primary} />
                <Text variant="heading">Checklist</Text>
              </Row>
              <Ionicons name="chevron-forward" size={20} color={t.colors.textMuted} />
            </Row>
            {progress ? (
              <>
                <ProgressBar value={progress.total ? progress.answered / progress.total : 0} />
                <Text variant="caption">
                  {progress.answered}/{progress.total} answered · {state.photos} photos
                </Text>
              </>
            ) : null}
          </Card>
          <Card
            onPress={() => router.push({ pathname: '/inspection/[id]/damage', params: { id } })}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <Ionicons name="locate" size={20} color={t.colors.primary} />
                <Text variant="heading">Damage markup</Text>
              </Row>
              <Text variant="caption">{state.pins} pins</Text>
            </Row>
          </Card>
          <Card
            onPress={() => router.push({ pathname: '/inspection/[id]/signature', params: { id } })}
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <Ionicons name="create-outline" size={20} color={t.colors.primary} />
                <Text variant="heading">Client signature</Text>
              </Row>
              {draft.signatureFileId ? (
                <Badge label="Signed" color={t.colors.success} icon="checkmark" />
              ) : (
                <Text variant="caption">Not yet signed</Text>
              )}
            </Row>
          </Card>
          <Button
            title="Review and submit"
            icon="checkmark-done"
            onPress={() => router.push({ pathname: '/inspection/[id]/submit', params: { id } })}
          />
        </>
      ) : null}

      {draft && ['queued', 'syncing', 'synced'].includes(job.localState) ? (
        <Card>
          <Row>
            <Ionicons
              name={job.localState === 'synced' ? 'cloud-done-outline' : 'cloud-upload-outline'}
              size={20}
              color={job.localState === 'synced' ? t.colors.success : t.colors.primary}
            />
            <Text variant="heading">
              {job.localState === 'synced' ? 'Submitted and synced' : 'Submitted on this device'}
            </Text>
          </Row>
          <ProgressBar value={state.opsTotal ? state.opsDone / state.opsTotal : 1} />
          <Text variant="caption">
            {state.opsDone} of {state.opsTotal} items sent
          </Text>
          {j.status === 'sent_back' ? (
            <Button
              title="Reopen and fix"
              icon="create-outline"
              onPress={() => {
                reopenAfterSendBack(getServices().db, id);
                router.push({ pathname: '/inspection/[id]/checklist', params: { id } });
              }}
            />
          ) : (
            <Button
              title="Open sync status"
              variant="secondary"
              onPress={() => router.push('/(assessor)/sync')}
            />
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
