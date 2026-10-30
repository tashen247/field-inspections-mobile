import { Ionicons } from '@expo/vector-icons';
import {
  INSPECTION_STATUS_LABELS,
  formatAddress,
  type Inspection,
  type InspectionStatus,
} from '@fim/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Badge, Card, EmptyState, ErrorState, Loading, Row, Text } from '../../components/ui';
import { getServices } from '../../services';
import { priorityColor, statusColor, useTheme } from '../../theme';

const FILTERS: (InspectionStatus | 'all')[] = [
  'all',
  'assigned',
  'in_progress',
  'submitted',
  'approved',
  'sent_back',
];

export default function ManagerInspections() {
  const t = useTheme();
  const [status, setStatus] = useState<InspectionStatus | 'all'>('submitted');
  const q = useInfiniteQuery({
    queryKey: ['inspections', status],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      getServices().api.listInspections({
        cursor: pageParam,
        ...(status === 'all' ? {} : { status }),
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
  // Oldest change first from the API; managers want the most recent on top.
  const items: Inspection[] = (q.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse();

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        style={{ flexGrow: 0 }}
        accessibilityRole="tablist"
      >
        {FILTERS.map((f) => {
          const active = f === status;
          const color = f === 'all' ? t.colors.primary : statusColor[f];
          return (
            <Pressable
              key={f}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setStatus(f)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? color : t.colors.border,
                backgroundColor: active ? `${color}22` : t.colors.surface,
              }}
            >
              <Text
                color={active ? color : t.colors.text}
                style={{ fontWeight: active ? '700' : '500' }}
              >
                {f === 'all' ? 'All' : INSPECTION_STATUS_LABELS[f]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 12, paddingTop: 0, gap: 10, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
          }
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
          ListEmptyComponent={
            <EmptyState
              icon="file-tray-outline"
              title="Nothing here"
              message="No inspections with this status."
            />
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 30)}>
              <Card
                onPress={() => router.push({ pathname: '/review/[id]', params: { id: item.id } })}
                accessibilityLabel={`${item.reference}, ${item.insuredName}, ${INSPECTION_STATUS_LABELS[item.status]}`}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row>
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: priorityColor[item.priority],
                      }}
                    />
                    <Text variant="label">{item.reference}</Text>
                  </Row>
                  <Badge
                    label={INSPECTION_STATUS_LABELS[item.status]}
                    color={statusColor[item.status]}
                  />
                </Row>
                <Text variant="heading" numberOfLines={1}>
                  {item.insuredName}
                </Text>
                <Text variant="muted" numberOfLines={1}>
                  {formatAddress(item.address)}
                </Text>
                <Row>
                  <Ionicons name="person-outline" size={14} color={t.colors.textMuted} />
                  <Text variant="caption">{item.assigneeName ?? 'Unassigned'}</Text>
                  <Text variant="caption">
                    · due {new Date(item.dueAt).toLocaleDateString('en-ZA')}
                  </Text>
                </Row>
              </Card>
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}
