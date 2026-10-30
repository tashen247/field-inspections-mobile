import { Ionicons } from '@expo/vector-icons';
import { PRIORITY_RANK, haversineMeters, type Inspection } from '@fim/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, RefreshControl, StyleSheet, View } from 'react-native';
import MapView, { Callout, Marker } from 'react-native-maps';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Button, EmptyState, Row, Segmented, Text } from '../../components/ui';
import { countTemplates, listJobs, type JobRow } from '../../db/repo';
import { submitInspection } from '../../features/inspection/actions';
import { JobCard } from '../../features/jobs/JobCard';
import { useCoarseLocation, useIsOnline } from '../../lib/hooks';
import { useDbQuery } from '../../lib/use-db';
import { syncNow } from '../../services';
import { useSyncStatus } from '../../sync/status';
import { draftIssues } from '../../sync/submission';
import { priorityColor, useTheme } from '../../theme';

type View_ = 'list' | 'map';
type Filter = 'today' | 'all';

function isOpen(j: Inspection) {
  return j.status === 'assigned' || j.status === 'in_progress' || j.status === 'sent_back';
}

export default function Jobs() {
  const t = useTheme();
  const [view, setView] = useState<View_>('list');
  const [filter, setFilter] = useState<Filter>('today');
  const online = useIsOnline();
  const here = useCoarseLocation();
  const syncing = useSyncStatus((s) => s.running);
  const lastError = useSyncStatus((s) => s.lastError);

  const { rows, readyToSubmit, templates } = useDbQuery((db) => {
    const all = listJobs(db);
    const ready = new Set(
      all
        .filter((r) => r.localState === 'working' && draftIssues(db, r.id).length === 0)
        .map((r) => r.id),
    );
    return { rows: all, readyToSubmit: ready, templates: countTemplates(db) };
  }, []);

  const visible = useMemo(() => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    return rows
      .filter((r) =>
        filter === 'all'
          ? true
          : r.localState === 'conflict' ||
            (isOpen(r.data) && Date.parse(r.data.dueAt) <= endOfToday.getTime()) ||
            r.localState === 'working',
      )
      .sort(
        (a, b) =>
          Number(b.localState === 'conflict') - Number(a.localState === 'conflict') ||
          PRIORITY_RANK[a.data.priority] - PRIORITY_RANK[b.data.priority] ||
          a.data.dueAt.localeCompare(b.data.dueAt),
      );
  }, [rows, filter]);

  const swipeFor = (r: JobRow): string | null => {
    if (r.localState === 'working' && readyToSubmit.has(r.id)) return 'Submit';
    if (r.localState === 'idle' && isOpen(r.data)) return 'Start';
    return null;
  };

  const onSwipe = (r: JobRow) => {
    if (swipeFor(r) === 'Submit') {
      const res = submitInspection(r.id);
      if (!res.ok) Alert.alert('Not quite done', res.issues[0]?.message ?? 'Check the checklist');
    } else {
      router.push({ pathname: '/inspection/[id]', params: { id: r.id, autostart: '1' } });
    }
  };

  const distance = (j: Inspection) => (here ? haversineMeters(here, j.location) : null);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ padding: 16, gap: 10 }}>
        {!online ? (
          <Row style={[styles.banner, { backgroundColor: `${t.colors.warning}22` }]}>
            <Ionicons name="cloud-offline-outline" size={16} color={t.colors.warning} />
            <Text variant="caption" style={{ flex: 1 }}>
              Offline. Everything you capture is saved on this device and syncs when you have
              signal.
            </Text>
          </Row>
        ) : null}
        <Row>
          <View style={{ flex: 1 }}>
            <Segmented
              accessibilityLabel="Which jobs"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'all', label: `All (${rows.length})` },
              ]}
            />
          </View>
          <View style={{ width: 120 }}>
            <Segmented
              accessibilityLabel="List or map"
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: '', icon: 'list', a11yLabel: 'List view' },
                { value: 'map', label: '', icon: 'map', a11yLabel: 'Map view' },
              ]}
            />
          </View>
        </Row>
        {rows.length > 0 ? (
          <Text variant="caption">
            {rows.length} job{rows.length === 1 ? '' : 's'} and {templates} checklist template
            {templates === 1 ? '' : 's'} saved for offline use
          </Text>
        ) : null}
      </View>

      {view === 'map' ? (
        <MapView
          style={{ flex: 1 }}
          showsUserLocation
          showsMyLocationButton
          key={visible.map((r) => r.id).join(',')}
          initialRegion={regionFor(visible.map((r) => r.data.location))}
        >
          {visible.map((r) => (
            <Marker
              key={r.id}
              coordinate={{ latitude: r.data.location.lat, longitude: r.data.location.lng }}
              pinColor={priorityColor[r.data.priority]}
              accessibilityLabel={`${r.data.reference}, ${r.data.insuredName}`}
            >
              <Callout
                onPress={() => router.push({ pathname: '/inspection/[id]', params: { id: r.id } })}
              >
                <View style={{ maxWidth: 220, padding: 4 }}>
                  <Text variant="label">{r.data.insuredName}</Text>
                  <Text variant="caption">{r.data.address.line1}</Text>
                  <Text variant="caption" color={t.colors.primary}>
                    Open job
                  </Text>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>
      ) : (
        <Animated.FlatList
          data={visible}
          keyExtractor={(r) => r.id}
          itemLayoutAnimation={LinearTransition}
          contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={syncing}
              onRefresh={() => void syncNow()}
              tintColor={t.colors.primary}
            />
          }
          ListEmptyComponent={
            syncing ? undefined : (
              <EmptyState
                icon="briefcase-outline"
                title={rows.length ? 'Nothing due today' : 'No jobs on this device yet'}
                message={
                  rows.length
                    ? 'Switch to All to see upcoming jobs.'
                    : (lastError ?? 'Download your assigned jobs to work offline.')
                }
                action={
                  rows.length ? undefined : (
                    <Button
                      title="Download jobs"
                      icon="cloud-download-outline"
                      onPress={() => void syncNow()}
                    />
                  )
                }
              />
            )
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40)}>
              <JobCard
                job={item.data}
                localState={item.localState}
                distanceMeters={distance(item.data)}
                swipeLabel={swipeFor(item)}
                onSwipe={() => onSwipe(item)}
                onPress={() =>
                  router.push(
                    item.localState === 'conflict'
                      ? { pathname: '/inspection/[id]/conflict', params: { id: item.id } }
                      : { pathname: '/inspection/[id]', params: { id: item.id } },
                  )
                }
              />
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

/** A map region that fits every job, with a margin so pins are not on the edge. */
export function regionFor(points: { lat: number; lng: number }[]) {
  if (points.length === 0) {
    return { latitude: -29.0, longitude: 25.0, latitudeDelta: 12, longitudeDelta: 12 };
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.5),
    longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.5),
  };
}

const styles = StyleSheet.create({
  banner: { padding: 10, borderRadius: 10 },
});
