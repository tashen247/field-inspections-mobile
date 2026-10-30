import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Button, Card, Row, Screen, Text, TextField } from '../../../components/ui';
import { getDraft, getJob, setSignature } from '../../../db/repo';
import { photoDir } from '../../../features/camera/process';
import { SignaturePad, type SignaturePadHandle } from '../../../features/signature/SignaturePad';
import { useDbQuery } from '../../../lib/use-db';
import { uuid } from '../../../lib/uuid';
import { getServices } from '../../../services';
import { useTheme } from '../../../theme';

export default function SignatureScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pad = useRef<SignaturePadHandle>(null);
  const s = useDbQuery((db) => ({ job: getJob(db, id), draft: getDraft(db, id) }), [id]);
  const [name, setName] = useState(s.draft?.signedName ?? s.job?.data.insuredName ?? '');
  const [empty, setEmpty] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const editable = s.job?.localState === 'working';

  const save = () => {
    const png = pad.current?.toPng();
    if (!png) return setError('Ask the client to sign first.');
    if (name.trim().length < 2) return setError('Enter the name of the person signing.');
    const fileId = uuid();
    const file = new File(photoDir(id), `signature-${fileId}.png`);
    file.create();
    file.write(png);
    const old = s.draft?.signatureUri;
    setSignature(getServices().db, id, {
      fileId,
      uri: file.uri,
      size: png.length,
      signedName: name.trim(),
      signedAt: new Date().toISOString(),
    });
    if (old) {
      const f = new File(old);
      if (f.exists) f.delete();
    }
    router.back();
  };

  return (
    <Screen scroll>
      {s.draft?.signatureUri ? (
        <Card>
          <Text variant="label">
            Signed by {s.draft.signedName} on {new Date(s.draft.signedAt!).toLocaleString('en-ZA')}
          </Text>
          <Image
            source={{ uri: s.draft.signatureUri }}
            style={{ height: 120, backgroundColor: '#fff', borderRadius: 8 }}
            contentFit="contain"
          />
          {editable ? <Text variant="caption">Signing again replaces this signature.</Text> : null}
        </Card>
      ) : null}
      {editable ? (
        <>
          <Text variant="muted">
            By signing, the client confirms the assessor inspected the {s.job?.data.subject.kind} on
            this date.
          </Text>
          <SignaturePad ref={pad} onChange={setEmpty} />
          <TextField
            label="Full name of the person signing"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          {error ? <Text color={t.colors.danger}>{error}</Text> : null}
          <Row>
            <Button
              style={{ flex: 1 }}
              title="Clear"
              variant="secondary"
              icon="refresh"
              onPress={() => pad.current?.clear()}
            />
            <Button
              style={{ flex: 1 }}
              title="Save signature"
              icon="checkmark"
              disabled={empty}
              onPress={save}
            />
          </Row>
        </>
      ) : null}
    </Screen>
  );
}
