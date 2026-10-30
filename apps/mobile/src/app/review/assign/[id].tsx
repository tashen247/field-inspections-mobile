import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import { Card, ErrorState, Loading, Row, Screen, Text } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { getServices } from '../../../services';
import { useTheme } from '../../../theme';

export default function AssignScreen() {
  const t = useTheme();
  const { id, version } = useLocalSearchParams<{ id: string; version: string }>();
  const qc = useQueryClient();
  const { api } = getServices();
  const assessors = useQuery({ queryKey: ['assessors'], queryFn: () => api.assessors() });
  const assign = useMutation({
    mutationFn: (assigneeId: string) =>
      api.assign(id, { assigneeId, baseVersion: Number(version) }),
    onSuccess: (inspection) => {
      qc.setQueryData(['inspection', id], (old: object | undefined) =>
        old ? { ...old, inspection } : old,
      );
      void qc.invalidateQueries({ queryKey: ['inspection', id] });
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      router.back();
    },
    onError: (err) =>
      Alert.alert(
        'Could not assign',
        err instanceof ApiError && err.code === 'VERSION_CONFLICT'
          ? 'The inspection changed in the meantime. Go back and try again.'
          : err.message,
      ),
  });

  if (assessors.isPending) return <Loading />;
  if (assessors.isError)
    return (
      <ErrorState message={assessors.error.message} onRetry={() => void assessors.refetch()} />
    );
  return (
    <Screen scroll>
      <Text variant="muted">
        The assessor gets a notification and the job downloads to their phone on the next sync.
      </Text>
      {assessors.data.items.map((u) => (
        <Card
          key={u.id}
          onPress={() => assign.mutate(u.id)}
          accessibilityLabel={`Assign to ${u.name}`}
        >
          <Row>
            <Ionicons name="person-circle-outline" size={32} color={t.colors.primary} />
            <Text variant="heading" style={{ flex: 1 }}>
              {u.name}
            </Text>
            {assign.isPending && assign.variables === u.id ? (
              <Text variant="caption">Assigning…</Text>
            ) : null}
          </Row>
          <Text variant="caption">{u.email}</Text>
        </Card>
      ))}
    </Screen>
  );
}
