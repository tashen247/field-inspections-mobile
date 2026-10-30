import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import {
  INSPECTION_STATUS_LABELS,
  flattenItems,
  formatAddress,
  formatZar,
  type InspectionDetail,
  type TemplateBody,
} from '@fim/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Loading,
  Row,
  Screen,
  Text,
  TextField,
} from '../../components/ui';
import { DamageDiagram } from '../../features/damage/DamageDiagram';
import { ApiError } from '../../lib/api';
import { getServices } from '../../services';
import { severityColor, statusColor, useTheme } from '../../theme';

const sendBackForm = z.object({
  comment: z.string().trim().min(3, 'Tell the assessor what to fix'),
});

function answerText(value: unknown): string {
  if (value === 'pass') return 'Pass';
  if (value === 'fail') return 'Fail';
  if (value === 'na') return 'N/A';
  if (value === null || value === undefined || value === '') return '–';
  return String(value);
}

export default function ReviewScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { api } = getServices();
  const [viewer, setViewer] = useState<string | null>(null);
  const [sendingBack, setSendingBack] = useState(false);

  const detail = useQuery({ queryKey: ['inspection', id], queryFn: () => api.detail(id) });
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.templates(),
    staleTime: 3_600_000,
  });

  const review = useMutation({
    mutationFn: (body: Parameters<typeof api.review>[1]) => api.review(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inspection', id] });
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      setSendingBack(false);
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError && err.code === 'VERSION_CONFLICT'
          ? 'Someone changed this inspection. Reloaded the latest version.'
          : err.message;
      Alert.alert('Could not save the review', msg);
      void detail.refetch();
    },
  });

  const report = useMutation({
    mutationFn: async () => {
      const r = await api.report(id);
      const dir = new Directory(Paths.cache, 'reports');
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const target = new File(dir, `${detail.data?.inspection.reference ?? id}.pdf`);
      if (target.exists) target.delete();
      const file = await File.downloadFileAsync(r.url, target);
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    },
    onError: (err) =>
      Alert.alert(
        'Report',
        err instanceof ApiError && err.code === 'REPORT_NOT_READY'
          ? 'The PDF is still being generated. Try again in a moment.'
          : err.message,
      ),
  });

  const form = useForm<z.infer<typeof sendBackForm>>({
    resolver: zodResolver(sendBackForm),
    defaultValues: { comment: '' },
  });

  if (detail.isPending) return <Loading />;
  if (detail.isError)
    return <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />;
  const d: InspectionDetail = detail.data;
  const i = d.inspection;
  const template: TemplateBody | undefined = templates.data?.items.find(
    (x) => x.id === i.templateId,
  )?.schema;
  const answers = new Map(d.answers.map((a) => [a.itemKey, a]));
  const canReview = i.status === 'submitted';
  const canAssign = ['assigned', 'in_progress', 'sent_back'].includes(i.status);
  const photosPending = d.photos.filter((p) => !p.uploadedAt).length;

  return (
    <Screen scroll>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label">{i.reference}</Text>
          <Badge label={INSPECTION_STATUS_LABELS[i.status]} color={statusColor[i.status]} />
        </Row>
        <Text variant="title">{i.insuredName}</Text>
        <Text variant="muted">
          {i.subject.kind === 'vehicle'
            ? `${i.subject.make} ${i.subject.model} · ${i.subject.registration}`
            : `${i.subject.propertyType}${i.subject.erfNumber ? ` · Erf ${i.subject.erfNumber}` : ''}`}
        </Text>
        <Text variant="muted">{formatAddress(i.address)}</Text>
        <Text variant="caption">
          Assessor: {i.assigneeName ?? 'Unassigned'} · Claim {i.claimNumber ?? '–'}
          {i.sumInsuredCents !== null ? ` · ${formatZar(i.sumInsuredCents)}` : ''}
        </Text>
        {canAssign ? (
          <Button
            title={i.assigneeId ? 'Reassign' : 'Assign assessor'}
            variant="secondary"
            icon="person-add-outline"
            onPress={() =>
              router.push({
                pathname: '/review/assign/[id]',
                params: { id, version: String(i.version) },
              })
            }
          />
        ) : null}
      </Card>

      {canReview ? (
        <Card>
          <Text variant="heading">Review</Text>
          {photosPending > 0 ? (
            <Text variant="caption" color={t.colors.warning}>
              {photosPending} photo{photosPending === 1 ? ' is' : 's are'} still uploading from the
              device.
            </Text>
          ) : null}
          {sendingBack ? (
            <>
              <Controller
                control={form.control}
                name="comment"
                render={({ field, fieldState }) => (
                  <TextField
                    label="What should the assessor fix?"
                    multiline
                    value={field.value}
                    onChangeText={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />
              <Row>
                <Button
                  style={{ flex: 1 }}
                  title="Cancel"
                  variant="secondary"
                  onPress={() => setSendingBack(false)}
                />
                <Button
                  style={{ flex: 1 }}
                  title="Send back"
                  variant="danger"
                  loading={review.isPending}
                  onPress={form.handleSubmit(({ comment }) =>
                    review.mutate({ action: 'send_back', baseVersion: i.version, comment }),
                  )}
                />
              </Row>
            </>
          ) : (
            <Row>
              <Button
                style={{ flex: 1 }}
                title="Send back"
                variant="secondary"
                icon="return-up-back"
                onPress={() => setSendingBack(true)}
              />
              <Button
                style={{ flex: 1 }}
                title="Approve"
                icon="checkmark-circle"
                loading={review.isPending}
                onPress={() => review.mutate({ action: 'approve', baseVersion: i.version })}
              />
            </Row>
          )}
        </Card>
      ) : null}

      {i.status === 'submitted' || i.status === 'approved' ? (
        <Button
          title={d.report ? 'Download PDF report' : 'PDF report is being generated'}
          variant="secondary"
          icon="document-text-outline"
          disabled={!d.report}
          loading={report.isPending}
          onPress={() => report.mutate()}
        />
      ) : null}

      {d.photos.length ? (
        <Card>
          <Text variant="heading">Photos ({d.photos.length})</Text>
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {d.photos.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Photo for ${p.itemKey}${p.shotKey ? `, ${p.shotKey}` : ''}`}
                onPress={() => p.url && setViewer(p.url)}
                style={styles.thumb}
              >
                {p.url ? (
                  <Image
                    source={{ uri: p.url }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={150}
                  />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={24} color={t.colors.textMuted} />
                )}
                <Text variant="caption" color="#fff" style={styles.thumbLabel} numberOfLines={1}>
                  {(p.shotKey ?? p.itemKey).replace(/_/g, ' ')}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Card>
      ) : null}

      {template ? (
        <Card>
          <Text variant="heading">Checklist</Text>
          {template.sections.map((s) => (
            <View key={s.key} style={{ gap: 4, marginTop: 6 }}>
              <Text variant="label" color={t.colors.primary}>
                {s.title}
              </Text>
              {s.items.map((item) => {
                const a = answers.get(item.key);
                const fail = a?.value === 'fail';
                return (
                  <View key={item.key} style={{ gap: 2 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text style={{ flex: 1 }}>{item.label}</Text>
                      <Text
                        style={{ fontWeight: '700' }}
                        color={fail ? t.colors.danger : undefined}
                      >
                        {answerText(a?.value)}
                        {item.kind === 'number' && item.unit && typeof a?.value === 'number'
                          ? ` ${item.unit}`
                          : ''}
                      </Text>
                    </Row>
                    {a?.note ? <Text variant="caption">{a.note}</Text> : null}
                  </View>
                );
              })}
            </View>
          ))}
          <Text variant="caption">{flattenItems(template).length} items</Text>
        </Card>
      ) : null}

      {d.damagePins.length ? (
        <Card>
          <Text variant="heading">Damage ({d.damagePins.length})</Text>
          <DamageDiagram diagram={d.damagePins[0]!.diagram} pins={d.damagePins} readOnly />
          {d.damagePins.map((p, n) => (
            <Text key={p.id} variant="muted">
              #{n + 1} <Text color={severityColor[p.severity]}>{p.severity}</Text> {p.note ?? ''}
            </Text>
          ))}
        </Card>
      ) : null}

      {d.signature ? (
        <Card>
          <Text variant="heading">Signature</Text>
          {d.signature.url ? (
            <Image
              source={{ uri: d.signature.url }}
              style={{ height: 110, backgroundColor: '#fff', borderRadius: 8 }}
              contentFit="contain"
            />
          ) : (
            <Text variant="caption">Uploading…</Text>
          )}
          <Text variant="muted">
            {d.signature.signedName} · {new Date(d.signature.signedAt).toLocaleString('en-ZA')}
          </Text>
        </Card>
      ) : null}

      {d.gpsTrail.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <MapView
            style={{ height: 220 }}
            initialRegion={{
              latitude: i.location.lat,
              longitude: i.location.lng,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
          >
            <Marker
              coordinate={{ latitude: i.location.lat, longitude: i.location.lng }}
              title="Address"
            />
            <Polyline
              coordinates={d.gpsTrail.map((g) => ({ latitude: g.lat, longitude: g.lng }))}
              strokeColor={t.colors.primary}
              strokeWidth={4}
            />
            <Marker
              coordinate={{ latitude: d.gpsTrail[0]!.lat, longitude: d.gpsTrail[0]!.lng }}
              title="Started here"
              pinColor="green"
            />
          </MapView>
          <View style={{ padding: 12 }}>
            <Text variant="caption">GPS trail: {d.gpsTrail.length} points</Text>
          </View>
        </Card>
      ) : null}

      <Card>
        <Text variant="heading">Audit trail</Text>
        {d.events.map((e) => (
          <View key={e.id} style={{ gap: 2 }}>
            <Text variant="label">
              {e.kind.replace('_', ' ')}
              {e.toStatus ? ` → ${INSPECTION_STATUS_LABELS[e.toStatus]}` : ''}
            </Text>
            <Text variant="caption">
              {new Date(e.createdAt).toLocaleString('en-ZA')} · {e.actorName ?? 'system'}
            </Text>
            {e.comment ? <Text variant="muted">“{e.comment}”</Text> : null}
          </View>
        ))}
      </Card>

      <Modal visible={!!viewer} animationType="fade" onRequestClose={() => setViewer(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <Image
            source={viewer ? { uri: viewer } : undefined}
            style={{ flex: 1 }}
            contentFit="contain"
          />
          <Button title="Close" variant="ghost" onPress={() => setViewer(null)} />
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: 110,
    height: 110,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0002',
  },
  thumbLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
