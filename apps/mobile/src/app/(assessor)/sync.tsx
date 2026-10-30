import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Badge, Button, Card, EmptyState, ProgressBar, Row, Text } from '../../components/ui';
import { getJob, getMeta, listOutbox, retryNow, type OutboxRow } from '../../db/repo';
import { useIsOnline } from '../../lib/hooks';
import { useDbQuery } from '../../lib/use-db';
import { getServices, syncNow } from '../../services';
import { useSyncStatus } from '../../sync/status';
import { useTheme } from '../../theme';

interface Group {
  inspectionId: string;
  title: string;
  ops: OutboxRow[];
  done: number;
  total: number;
  failed: OutboxRow[];
  blocked: boolean;
  waiting: OutboxRow | undefined;
}

const KIND_LABEL = { start: 'Start time', submit: 'Checklist data', upload: 'Photo' } as const;

export default function SyncScreen() {
  const t = useTheme();
  const online = useIsOnline();
  const running = useSyncStatus((s) => s.running);
  const last = useSyncStatus((s) => s.lastRunAt);

  const { groups, lastPull } = useDbQuery((db) => {
    const byId = new Map<string, OutboxRow[]>();
    for (const op of listOutbox(db)) {
      byId.set(op.inspectionId, [...(byId.get(op.inspectionId) ?? []), op]);
    }
    const out: Group[] = [];
    for (const [inspectionId, ops] of byId) {
      const done = ops.filter((o) => o.status === 'done').length;
      if (
        done === ops.length &&
        ops.every((o) => Date.parse(o.createdAt) < Date.now() - 86_400_000)
      )
        continue;
      const job = getJob(db, inspectionId);
      out.push({
        inspectionId,
        title: job ? `${job.data.reference} · ${job.data.insuredName}` : inspectionId,
        ops,
        done,
        total: ops.length,
        failed: ops.filter((o) => o.status === 'failed'),
        blocked: ops.some((o) => o.status === 'blocked'),
        waiting: ops.find((o) => o.status === 'pending' && o.attempts > 0),
      });
    }
    return { groups: out.reverse(), lastPull: getMeta(db, 'lastSyncServerTime') };
  }, []);

  const pending = groups.reduce((n, g) => n + g.total - g.done, 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.inspectionId}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        ListHeaderComponent={
          <Card style={{ marginBottom: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <Ionicons
                  name={online ? 'cloud-done-outline' : 'cloud-offline-outline'}
                  size={22}
                  color={online ? t.colors.success : t.colors.warning}
                />
                <Text variant="heading">{online ? 'Online' : 'Offline'}</Text>
              </Row>
              <Text variant="caption">{pending} waiting</Text>
            </Row>
            <Text variant="muted">
              {pending === 0
                ? 'Everything on this device has reached the server.'
                : online
                  ? 'Sending in the background. You can keep working or close the app.'
                  : 'Saved on this device. It will send automatically when you have signal.'}
            </Text>
            {last || lastPull ? (
              <Text variant="caption">
                Last checked {new Date(last ?? lastPull!).toLocaleTimeString('en-ZA')}
              </Text>
            ) : null}
            <Button
              title={running ? 'Syncing…' : 'Sync now'}
              icon="sync"
              loading={running}
              onPress={() => {
                retryNow(getServices().db);
                void syncNow();
              }}
            />
          </Card>
        }
        ListEmptyComponent={
          <EmptyState
            icon="cloud-done-outline"
            title="Nothing to sync"
            message="Submitted inspections appear here until every photo has uploaded."
          />
        }
        renderItem={({ item: g }) => (
          <Animated.View entering={FadeIn}>
            <Card
              onPress={() =>
                router.push(
                  g.blocked
                    ? { pathname: '/inspection/[id]/conflict', params: { id: g.inspectionId } }
                    : { pathname: '/inspection/[id]', params: { id: g.inspectionId } },
                )
              }
              accessibilityLabel={`${g.title}, ${g.done} of ${g.total} sent`}
            >
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                  {g.title}
                </Text>
                {g.blocked ? (
                  <Badge label="Needs decision" color={t.colors.danger} icon="warning" />
                ) : g.failed.length ? (
                  <Badge label="Failed" color={t.colors.danger} icon="close-circle" />
                ) : g.done === g.total ? (
                  <Badge label="Synced" color={t.colors.success} icon="checkmark" />
                ) : (
                  <Badge label="Pending" color={t.colors.warning} icon="time-outline" />
                )}
              </Row>
              <ProgressBar
                value={g.total ? g.done / g.total : 1}
                color={g.failed.length ? t.colors.danger : undefined}
              />
              <Text variant="caption">
                {g.done} of {g.total} sent ({g.ops.filter((o) => o.kind === 'upload').length} photos
                and signature)
              </Text>
              {g.waiting?.lastError ? (
                <Text variant="caption" color={t.colors.warning}>
                  Retrying {new Date(g.waiting.nextAttemptAt).toLocaleTimeString('en-ZA')}:{' '}
                  {g.waiting.lastError}
                </Text>
              ) : null}
              {g.failed.map((f) => (
                <View key={f.id} style={{ gap: 6 }}>
                  <Text variant="caption" color={t.colors.danger}>
                    {KIND_LABEL[f.kind]}: {f.lastError}
                  </Text>
                </View>
              ))}
              {g.failed.length ? (
                <Button
                  title="Retry failed items"
                  variant="secondary"
                  icon="refresh"
                  onPress={() => {
                    retryNow(getServices().db, g.inspectionId);
                    void syncNow({ pull: false });
                  }}
                />
              ) : null}
            </Card>
          </Animated.View>
        )}
      />
    </View>
  );
}
