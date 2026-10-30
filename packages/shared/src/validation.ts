import type { AnswerValue } from './inspection.js';
import type { ChecklistItem, TemplateBody } from './template.js';
import { flattenItems } from './template.js';

export type ChecklistIssueKind =
  | 'required'
  | 'invalid_value'
  | 'out_of_range'
  | 'note_required'
  | 'photo_required'
  | 'signature_required'
  | 'unknown_item';

export interface ChecklistIssue {
  itemKey: string | null;
  kind: ChecklistIssueKind;
  message: string;
}

export interface ChecklistInput {
  answers: ReadonlyArray<{ itemKey: string; value: AnswerValue; note?: string | null }>;
  photos: ReadonlyArray<{ itemKey: string; shotKey?: string | null }>;
  hasSignature: boolean;
}

export function isEmptyValue(value: AnswerValue | undefined): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
}

/** Checks a single value against its item definition. Returns null when acceptable. */
export function validateItemValue(
  item: ChecklistItem,
  value: AnswerValue | undefined,
  note?: string | null,
): Omit<ChecklistIssue, 'itemKey'> | null {
  if (isEmptyValue(value)) {
    return item.required ? { kind: 'required', message: `${item.label} is required` } : null;
  }
  switch (item.kind) {
    case 'passFail': {
      if (value !== 'pass' && value !== 'fail' && value !== 'na') {
        return { kind: 'invalid_value', message: `${item.label} must be pass, fail or N/A` };
      }
      if (value === 'na' && !item.allowNa) {
        return { kind: 'invalid_value', message: `${item.label} cannot be N/A` };
      }
      if (value === 'fail' && item.noteOnFail && (!note || note.trim() === '')) {
        return { kind: 'note_required', message: `Add a note explaining why ${item.label} failed` };
      }
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { kind: 'invalid_value', message: `${item.label} must be a number` };
      }
      if (item.integer && !Number.isInteger(value)) {
        return { kind: 'invalid_value', message: `${item.label} must be a whole number` };
      }
      if (item.min !== undefined && value < item.min) {
        return { kind: 'out_of_range', message: `${item.label} must be at least ${item.min}` };
      }
      if (item.max !== undefined && value > item.max) {
        return { kind: 'out_of_range', message: `${item.label} must be at most ${item.max}` };
      }
      return null;
    }
    case 'select': {
      if (typeof value !== 'string' || !item.options.some((o) => o.value === value)) {
        return { kind: 'invalid_value', message: `Choose a valid option for ${item.label}` };
      }
      return null;
    }
    case 'text': {
      if (typeof value !== 'string') {
        return { kind: 'invalid_value', message: `${item.label} must be text` };
      }
      if (value.length > item.maxLength) {
        return {
          kind: 'out_of_range',
          message: `${item.label} must be ${item.maxLength} characters or fewer`,
        };
      }
      return null;
    }
  }
}

/**
 * Validates a full checklist against its template. The same function runs on the device
 * (to block submit) and on the API (to reject a bad submission), so the rules never drift.
 */
export function validateChecklist(body: TemplateBody, input: ChecklistInput): ChecklistIssue[] {
  const issues: ChecklistIssue[] = [];
  const answers = new Map(input.answers.map((a) => [a.itemKey, a]));
  const knownKeys = new Set<string>();

  for (const { item } of flattenItems(body)) {
    knownKeys.add(item.key);
    const answer = answers.get(item.key);
    const issue = validateItemValue(item, answer?.value, answer?.note);
    if (issue) issues.push({ itemKey: item.key, ...issue });

    const photos = input.photos.filter((p) => p.itemKey === item.key);
    for (const shot of item.shots) {
      if (shot.required && !photos.some((p) => p.shotKey === shot.key)) {
        issues.push({
          itemKey: item.key,
          kind: 'photo_required',
          message: `Take the "${shot.label}" photo`,
        });
      }
    }
    const freePhotos = photos.filter((p) => !p.shotKey).length;
    if (freePhotos < item.minPhotos) {
      issues.push({
        itemKey: item.key,
        kind: 'photo_required',
        message: `${item.label} needs at least ${item.minPhotos} photo${item.minPhotos === 1 ? '' : 's'}`,
      });
    }
  }

  for (const key of answers.keys()) {
    if (!knownKeys.has(key)) {
      issues.push({
        itemKey: key,
        kind: 'unknown_item',
        message: `Unknown checklist item "${key}"`,
      });
    }
  }

  if (body.requireSignature && !input.hasSignature) {
    issues.push({
      itemKey: null,
      kind: 'signature_required',
      message: 'Capture the client signature',
    });
  }
  return issues;
}

/** Progress for a section or whole checklist: answered vs total items. */
export function checklistProgress(
  body: TemplateBody,
  answers: ReadonlyArray<{ itemKey: string; value: AnswerValue }>,
): { answered: number; total: number; requiredRemaining: number } {
  const answered = new Set(answers.filter((a) => !isEmptyValue(a.value)).map((a) => a.itemKey));
  let total = 0;
  let done = 0;
  let requiredRemaining = 0;
  for (const { item } of flattenItems(body)) {
    total += 1;
    if (answered.has(item.key)) done += 1;
    else if (item.required) requiredRemaining += 1;
  }
  return { answered: done, total, requiredRemaining };
}
