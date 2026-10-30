import type { TemplateBody } from '@fim/shared';
import { findItem } from '@fim/shared';

/** The guided-shot sequence for an item: what to take now, and which required shots remain. */
export function shotPlan(
  template: TemplateBody,
  itemKey: string,
  shotKey: string | null,
  taken: ReadonlyArray<{ itemKey: string; shotKey: string | null }>,
) {
  const item = findItem(template, itemKey);
  if (!item) return null;
  const done = new Set(
    taken.filter((p) => p.itemKey === itemKey && p.shotKey).map((p) => p.shotKey),
  );
  const current = shotKey ? (item.shots.find((s) => s.key === shotKey) ?? null) : null;
  const remaining = item.shots.filter((s) => !done.has(s.key) && s.key !== current?.key);
  return {
    item,
    current,
    label: current?.label ?? `${item.label} (extra photo)`,
    hint: current?.hint ?? null,
    next: remaining.find((s) => s.required) ?? remaining[0] ?? null,
    remainingRequired: remaining.filter((s) => s.required).length,
  };
}
