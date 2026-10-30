import type { Severity } from '@fim/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Row, Screen, Segmented, Text, TextField } from '../../../components/ui';
import { deletePin, getJob, getTemplate, listPins, upsertPin } from '../../../db/repo';
import { DamageDiagram } from '../../../features/damage/DamageDiagram';
import { useDbQuery } from '../../../lib/use-db';
import { uuid } from '../../../lib/uuid';
import { getServices } from '../../../services';
import { severityColor } from '../../../theme';

export default function DamageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [selected, setSelected] = useState<string | null>(null);
  const s = useDbQuery(
    (db) => {
      const job = getJob(db, id);
      const template = job ? getTemplate(db, job.data.templateId) : undefined;
      return {
        diagram:
          template?.schema.diagram ??
          (job?.data.subject.kind === 'property' ? 'floor-plan' : 'vehicle-top'),
        pins: listPins(db, id),
        editable: job?.localState === 'working',
      };
    },
    [id],
  );
  const db = getServices().db;
  const pin = s.pins.find((p) => p.id === selected);

  return (
    <Screen scroll>
      <Text variant="muted">
        {s.editable
          ? 'Tap the diagram where the damage is. Tap a pin to edit it, then drag to move it.'
          : 'Damage recorded for this inspection.'}
      </Text>
      <DamageDiagram
        diagram={s.diagram}
        pins={s.pins}
        selectedId={selected}
        readOnly={!s.editable}
        onAdd={(x, y) => {
          const newId = uuid();
          upsertPin(db, {
            id: newId,
            inspectionId: id,
            diagram: s.diagram,
            x,
            y,
            severity: 'moderate',
            note: null,
          });
          setSelected(newId);
        }}
        onSelect={setSelected}
        onMove={(pinId, x, y) => {
          const p = s.pins.find((q) => q.id === pinId);
          if (p) upsertPin(db, { ...p, x, y });
        }}
      />
      {pin && s.editable ? (
        <Card>
          <Text variant="heading">Pin {s.pins.indexOf(pin) + 1}</Text>
          <Segmented<Severity>
            accessibilityLabel="Severity"
            value={pin.severity}
            onChange={(severity) => upsertPin(db, { ...pin, severity })}
            options={[
              { value: 'minor', label: 'Minor', color: severityColor.minor },
              { value: 'moderate', label: 'Moderate', color: severityColor.moderate },
              { value: 'severe', label: 'Severe', color: severityColor.severe },
            ]}
          />
          <TextField
            key={pin.id}
            label="Note"
            placeholder="e.g. Dent and scratch on left rear door"
            defaultValue={pin.note ?? ''}
            onEndEditing={(e) => upsertPin(db, { ...pin, note: e.nativeEvent.text.trim() || null })}
          />
          <Row>
            <Button
              style={{ flex: 1 }}
              title="Delete pin"
              variant="danger"
              icon="trash-outline"
              onPress={() => {
                deletePin(db, pin.id);
                setSelected(null);
              }}
            />
            <Button
              style={{ flex: 1 }}
              title="Done"
              variant="secondary"
              onPress={() => setSelected(null)}
            />
          </Row>
        </Card>
      ) : null}
      {s.pins.map((p, i) => (
        <Card key={p.id} onPress={() => setSelected(p.id)} accessibilityLabel={`Pin ${i + 1}`}>
          <Row>
            <Text variant="label">#{i + 1}</Text>
            <Text color={severityColor[p.severity]} style={{ fontWeight: '700' }}>
              {p.severity}
            </Text>
            <Text variant="muted" style={{ flex: 1 }} numberOfLines={1}>
              {p.note ?? 'No note'}
            </Text>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
