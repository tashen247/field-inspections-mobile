import { router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import { EmptyState, Screen } from '../../../components/ui';
import { getDraft, getJob, listAnswers, listPhotos } from '../../../db/repo';
import { ConflictView } from '../../../features/conflict/ConflictView';
import { discardInspectionFiles } from '../../../features/inspection/actions';
import { useDbQuery } from '../../../lib/use-db';
import { getServices, syncNow } from '../../../services';
import { resubmitOnLatest } from '../../../sync/conflicts';

export default function ConflictScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useDbQuery(
    (db) => ({
      job: getJob(db, id),
      answers: listAnswers(db, id).length,
      photos: listPhotos(db, id).length,
      signed: !!getDraft(db, id)?.signatureFileId,
    }),
    [id],
  );
  if (!s.job?.conflict) {
    return (
      <Screen>
        <EmptyState
          icon="checkmark-circle-outline"
          title="No conflict"
          message="This inspection is in sync."
        />
      </Screen>
    );
  }
  const summary = `${s.answers} answers, ${s.photos} photos${s.signed ? ', client signature' : ''}`;
  return (
    <Screen scroll>
      <ConflictView
        details={s.job.conflict}
        localSummary={summary}
        onResubmit={() => {
          resubmitOnLatest(getServices().db, id);
          void syncNow({ pull: false });
          router.back();
        }}
        onDiscard={() =>
          Alert.alert(
            'Discard your work?',
            `This deletes ${summary} from this device. It cannot be undone.`,
            [
              { text: 'Keep it', style: 'cancel' },
              {
                text: 'Discard',
                style: 'destructive',
                onPress: () => {
                  discardInspectionFiles(id);
                  router.dismissTo('/(assessor)/jobs');
                },
              },
            ],
          )
        }
        onLater={() => router.back()}
      />
    </Screen>
  );
}
