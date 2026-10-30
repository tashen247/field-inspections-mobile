import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Button, EmptyState, Screen } from '../../../components/ui';
import {
  getDraft,
  getJob,
  getTemplate,
  listAnswers,
  listPhotos,
  setAnswer,
  setNote,
} from '../../../db/repo';
import { ChecklistRenderer, type AnswerState } from '../../../features/checklist/ChecklistRenderer';
import { useInspectionTracking } from '../../../features/inspection/actions';
import { useDbQuery } from '../../../lib/use-db';
import { getServices } from '../../../services';
import { draftIssues } from '../../../sync/submission';

export default function ChecklistScreen() {
  const { id, showIssues } = useLocalSearchParams<{ id: string; showIssues?: string }>();
  const data = useDbQuery(
    (db) => {
      const job = getJob(db, id);
      const template = job ? getTemplate(db, job.data.templateId) : undefined;
      const answers: Record<string, AnswerState> = {};
      for (const a of listAnswers(db, id))
        answers[a.itemKey] = { value: a.value ?? null, note: a.note };
      return {
        job,
        template,
        editable: job?.localState === 'working' && !!getDraft(db, id),
        answers,
        photos: listPhotos(db, id).map((p) => ({
          id: p.id,
          itemKey: p.itemKey,
          shotKey: p.shotKey,
          uri: p.fileUri,
        })),
        issues: showIssues ? draftIssues(db, id) : undefined,
      };
    },
    [id, showIssues],
  );
  useInspectionTracking(id, data.editable);

  const onChange = useCallback(
    (itemKey: string, value: Parameters<typeof setAnswer>[3]) =>
      setAnswer(getServices().db, id, itemKey, value),
    [id],
  );
  const onNote = useCallback(
    (itemKey: string, note: string) => setNote(getServices().db, id, itemKey, note || null),
    [id],
  );

  if (!data.template) {
    return (
      <Screen>
        <EmptyState
          icon="document-outline"
          title="Checklist not downloaded"
          message="Sync once with signal to fetch checklist templates."
        />
      </Screen>
    );
  }
  return (
    <Screen scroll>
      <ChecklistRenderer
        template={data.template.schema}
        answers={data.answers}
        photos={data.photos}
        issues={data.issues}
        readOnly={!data.editable}
        onChange={onChange}
        onNote={onNote}
        onTakePhoto={(itemKey, shotKey) =>
          router.push({
            pathname: '/inspection/[id]/camera',
            params: { id, itemKey, shotKey: shotKey ?? '' },
          })
        }
        onOpenPhoto={(photoId) =>
          router.push({ pathname: '/inspection/[id]/photo/[photoId]', params: { id, photoId } })
        }
      />
      {data.editable ? (
        <Button
          title="Review and submit"
          icon="checkmark-done"
          onPress={() => router.push({ pathname: '/inspection/[id]/submit', params: { id } })}
        />
      ) : null}
    </Screen>
  );
}
