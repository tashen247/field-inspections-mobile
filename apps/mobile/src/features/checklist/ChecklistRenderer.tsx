import { Ionicons } from '@expo/vector-icons';
import {
  checklistProgress,
  validateItemValue,
  type AnswerValue,
  type ChecklistIssue,
  type ChecklistItem,
  type ChecklistSection,
  type TemplateBody,
} from '@fim/shared';
import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { Badge, Card, ProgressBar, Row, Segmented, Text } from '../../components/ui';
import { useTheme } from '../../theme';

export interface AnswerState {
  value: AnswerValue;
  note: string | null;
}

export interface PhotoThumb {
  id: string;
  itemKey: string;
  shotKey: string | null;
  uri: string;
}

export interface ChecklistRendererProps {
  template: TemplateBody;
  answers: Record<string, AnswerState | undefined>;
  photos: PhotoThumb[];
  /** Shown after the assessor tries to submit, so errors don't nag while they work. */
  issues?: ChecklistIssue[];
  readOnly?: boolean;
  onChange?: (itemKey: string, value: AnswerValue) => void;
  onNote?: (itemKey: string, note: string) => void;
  onTakePhoto?: (itemKey: string, shotKey: string | null) => void;
  onOpenPhoto?: (photoId: string) => void;
}

/** Renders any vehicle or property template; every change is persisted by the caller. */
export function ChecklistRenderer(props: ChecklistRendererProps) {
  const { template, answers } = props;
  const progress = checklistProgress(
    template,
    Object.entries(answers).map(([itemKey, a]) => ({ itemKey, value: a?.value ?? null })),
  );
  return (
    <View style={{ gap: 12 }} testID="checklist">
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="label">
            {progress.answered} of {progress.total} answered
          </Text>
          {progress.requiredRemaining > 0 ? (
            <Text variant="caption">{progress.requiredRemaining} required left</Text>
          ) : (
            <Badge label="All required done" color="#2E8540" icon="checkmark" />
          )}
        </Row>
        <ProgressBar value={progress.total ? progress.answered / progress.total : 0} />
      </Card>
      {template.sections.map((section) => (
        <SectionCard key={section.key} section={section} {...props} />
      ))}
    </View>
  );
}

function SectionCard({
  section,
  ...props
}: ChecklistRendererProps & { section: ChecklistSection }) {
  const t = useTheme();
  const [open, setOpen] = useState(true);
  const answered = section.items.filter((i) => {
    const v = props.answers[i.key]?.value;
    return v !== undefined && v !== null && v !== '';
  }).length;
  return (
    <Animated.View layout={LinearTransition}>
      <Card>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${section.title}, ${answered} of ${section.items.length} answered`}
          onPress={() => setOpen((o) => !o)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View style={{ flex: 1 }}>
            <Text variant="heading">{section.title}</Text>
            {section.description ? <Text variant="muted">{section.description}</Text> : null}
          </View>
          <Text variant="caption">
            {answered}/{section.items.length}
          </Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={t.colors.textMuted}
          />
        </Pressable>
        {open
          ? section.items.map((item) => (
              <Animated.View key={item.key} entering={FadeIn}>
                <ItemField item={item} {...props} />
              </Animated.View>
            ))
          : null}
      </Card>
    </Animated.View>
  );
}

const ItemField = memo(function ItemField({
  item,
  answers,
  photos,
  issues,
  readOnly,
  onChange,
  onNote,
  onTakePhoto,
  onOpenPhoto,
}: ChecklistRendererProps & { item: ChecklistItem }) {
  const t = useTheme();
  const answer = answers[item.key];
  const itemIssues = (issues ?? []).filter((i) => i.itemKey === item.key);
  const itemPhotos = photos.filter((p) => p.itemKey === item.key);
  const showNote = item.kind === 'passFail' && (answer?.value === 'fail' || !!answer?.note);

  return (
    <View testID={`item-${item.key}`} style={[styles.item, { borderTopColor: t.colors.border }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="label" style={{ flex: 1 }}>
          {item.label}
          {item.required ? <Text color={t.colors.danger}> *</Text> : null}
        </Text>
        {item.kind === 'number' && item.unit ? <Text variant="caption">{item.unit}</Text> : null}
      </Row>
      {item.hint ? <Text variant="caption">{item.hint}</Text> : null}

      {item.kind === 'passFail' ? (
        <Segmented
          accessibilityLabel={item.label}
          value={(answer?.value as string) ?? ''}
          onChange={(v) => !readOnly && onChange?.(item.key, v as AnswerValue)}
          options={[
            { value: 'pass', label: 'Pass', icon: 'checkmark-circle', color: t.colors.success },
            { value: 'fail', label: 'Fail', icon: 'close-circle', color: t.colors.danger },
            ...(item.allowNa
              ? [{ value: 'na', label: 'N/A', icon: 'remove-circle' as const }]
              : []),
          ]}
        />
      ) : null}

      {item.kind === 'number' ? (
        <NumberInput item={item} value={answer?.value} readOnly={readOnly} onChange={onChange} />
      ) : null}

      {item.kind === 'select' ? (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
          accessibilityRole="radiogroup"
        >
          {item.options.map((o) => {
            const active = answer?.value === o.value;
            return (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={o.label}
                disabled={readOnly}
                onPress={() => onChange?.(item.key, o.value)}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? t.colors.primary : t.colors.border,
                    backgroundColor: active ? t.colors.primarySoft : t.colors.surface,
                  },
                ]}
              >
                <Text
                  color={active ? t.colors.primary : t.colors.text}
                  style={{ fontWeight: active ? '700' : '400' }}
                >
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {item.kind === 'text' ? (
        <DebouncedInput
          label={item.label}
          multiline={item.multiline}
          maxLength={item.maxLength}
          value={typeof answer?.value === 'string' ? answer.value : ''}
          readOnly={readOnly}
          onCommit={(v) => onChange?.(item.key, v)}
        />
      ) : null}

      {showNote ? (
        <DebouncedInput
          label={`Note for ${item.label}`}
          placeholder={
            item.kind === 'passFail' && item.noteOnFail
              ? 'Required: describe the problem'
              : 'Add a note'
          }
          multiline
          value={answer?.note ?? ''}
          readOnly={readOnly}
          onCommit={(v) => onNote?.(item.key, v)}
        />
      ) : null}

      {item.shots.length > 0 || item.minPhotos > 0 || itemPhotos.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {item.shots.map((shot) => {
            const photo = itemPhotos.find((p) => p.shotKey === shot.key);
            return (
              <ShotTile
                key={shot.key}
                label={shot.label}
                required={shot.required}
                uri={photo?.uri}
                disabled={readOnly}
                onPress={() =>
                  photo ? onOpenPhoto?.(photo.id) : onTakePhoto?.(item.key, shot.key)
                }
              />
            );
          })}
          {itemPhotos
            .filter((p) => !p.shotKey)
            .map((p) => (
              <ShotTile key={p.id} label="Photo" uri={p.uri} onPress={() => onOpenPhoto?.(p.id)} />
            ))}
          {!readOnly ? (
            <ShotTile label="Add photo" icon="add" onPress={() => onTakePhoto?.(item.key, null)} />
          ) : null}
        </View>
      ) : null}

      {itemIssues.map((issue) => (
        <Row key={issue.kind + issue.message}>
          <Ionicons name="alert-circle" size={16} color={t.colors.danger} />
          <Text variant="caption" color={t.colors.danger} accessibilityRole="text">
            {issue.message}
          </Text>
        </Row>
      ))}
    </View>
  );
});

function NumberInput({
  item,
  value,
  readOnly,
  onChange,
}: {
  item: Extract<ChecklistItem, { kind: 'number' }>;
  value: AnswerValue | undefined;
  readOnly?: boolean | undefined;
  onChange?: ((itemKey: string, value: AnswerValue) => void) | undefined;
}) {
  const t = useTheme();
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '');
  useEffect(() => {
    setText(typeof value === 'number' ? String(value) : '');
  }, [value]);
  const parsed = text.trim() === '' ? null : Number(text.replace(',', '.'));
  const problem =
    parsed === null ? null : validateItemValue(item, Number.isNaN(parsed) ? text : parsed);
  return (
    <View style={{ gap: 4 }}>
      <TextInput
        accessibilityLabel={item.label}
        editable={!readOnly}
        keyboardType={item.integer ? 'number-pad' : 'decimal-pad'}
        value={text}
        onChangeText={setText}
        onEndEditing={() => {
          if (parsed === null) onChange?.(item.key, null);
          else if (!Number.isNaN(parsed)) onChange?.(item.key, parsed);
        }}
        placeholder={
          item.min !== undefined && item.max !== undefined
            ? `${item.min} – ${item.max}`
            : 'Enter a value'
        }
        placeholderTextColor={t.colors.textMuted}
        style={[
          styles.input,
          {
            color: t.colors.text,
            borderColor: problem ? t.colors.danger : t.colors.border,
            backgroundColor: t.colors.surface,
          },
        ]}
      />
      {problem ? (
        <Text variant="caption" color={t.colors.danger}>
          {problem.message}
        </Text>
      ) : null}
    </View>
  );
}

function DebouncedInput({
  label,
  value,
  onCommit,
  multiline,
  maxLength,
  placeholder,
  readOnly,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  readOnly?: boolean | undefined;
}) {
  const t = useTheme();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  // Persist shortly after typing stops, and always on blur.
  useEffect(() => {
    if (text === value) return;
    const h = setTimeout(() => onCommit(text), 600);
    return () => clearTimeout(h);
  }, [text, value, onCommit]);
  return (
    <TextInput
      accessibilityLabel={label}
      editable={!readOnly}
      value={text}
      onChangeText={setText}
      onBlur={() => text !== value && onCommit(text)}
      multiline={multiline}
      maxLength={maxLength}
      placeholder={placeholder ?? 'Type here'}
      placeholderTextColor={t.colors.textMuted}
      style={[
        styles.input,
        { color: t.colors.text, borderColor: t.colors.border, backgroundColor: t.colors.surface },
        multiline ? { minHeight: 72, textAlignVertical: 'top' } : null,
      ]}
    />
  );
}

function ShotTile({
  label,
  uri,
  required,
  icon = 'camera',
  onPress,
  disabled,
}: {
  label: string;
  uri?: string | undefined;
  required?: boolean;
  icon?: 'camera' | 'add';
  onPress: () => void;
  disabled?: boolean | undefined;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        uri ? `View ${label} photo` : `Take ${label} photo${required ? ', required' : ''}`
      }
      onPress={onPress}
      disabled={disabled && !uri}
      style={[
        styles.tile,
        {
          borderColor: required && !uri ? t.colors.warning : t.colors.border,
          backgroundColor: t.colors.surfaceAlt,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <Ionicons name={icon} size={22} color={t.colors.textMuted} />
      )}
      <View style={styles.tileLabel}>
        <Text variant="caption" color="#fff" numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  tile: {
    width: 84,
    height: 84,
    borderRadius: 10,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
