import { z } from 'zod';
import { diagramSchema, templateTypeSchema } from './enums.js';

const keySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/, 'keys are lower-case slugs');

/** A guided photo the assessor is prompted to take, e.g. "front-left" or "VIN plate". */
export const guidedShotSchema = z.object({
  key: keySchema,
  label: z.string().min(1),
  hint: z.string().optional(),
  required: z.boolean().default(false),
  /** Name of an example image served at /v1/reference-images/<name>.svg and cached offline. */
  reference: z.string().optional(),
});
export type GuidedShot = z.infer<typeof guidedShotSchema>;

const itemBase = {
  key: keySchema,
  label: z.string().min(1),
  hint: z.string().optional(),
  required: z.boolean().default(false),
  /** Guided shots shown on this item; required shots block submission. */
  shots: z.array(guidedShotSchema).default([]),
  /** Minimum number of free photos (in addition to guided shots). */
  minPhotos: z.number().int().min(0).default(0),
};

export const passFailItemSchema = z.object({
  ...itemBase,
  kind: z.literal('passFail'),
  allowNa: z.boolean().default(true),
  /** A note is required when the answer is "fail". */
  noteOnFail: z.boolean().default(false),
});

export const numberItemSchema = z.object({
  ...itemBase,
  kind: z.literal('number'),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  integer: z.boolean().default(false),
});

export const selectItemSchema = z.object({
  ...itemBase,
  kind: z.literal('select'),
  options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).min(1),
});

export const textItemSchema = z.object({
  ...itemBase,
  kind: z.literal('text'),
  multiline: z.boolean().default(false),
  maxLength: z.number().int().positive().default(2000),
});

export const checklistItemSchema = z.discriminatedUnion('kind', [
  passFailItemSchema,
  numberItemSchema,
  selectItemSchema,
  textItemSchema,
]);
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type ChecklistItemKind = ChecklistItem['kind'];

export const checklistSectionSchema = z.object({
  key: keySchema,
  title: z.string().min(1),
  description: z.string().optional(),
  items: z.array(checklistItemSchema).min(1),
});
export type ChecklistSection = z.infer<typeof checklistSectionSchema>;

export const templateBodySchema = z
  .object({
    diagram: diagramSchema,
    requireSignature: z.boolean().default(true),
    sections: z.array(checklistSectionSchema).min(1),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    for (const section of body.sections) {
      for (const item of section.items) {
        if (seen.has(item.key)) {
          ctx.addIssue({ code: 'custom', message: `duplicate item key "${item.key}"` });
        }
        seen.add(item.key);
      }
    }
  });
export type TemplateBody = z.infer<typeof templateBodySchema>;

export const templateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: templateTypeSchema,
  version: z.number().int().positive(),
  schema: templateBodySchema,
  createdAt: z.iso.datetime(),
});
export type Template = z.infer<typeof templateSchema>;

export const templateListResponseSchema = z.object({ items: z.array(templateSchema) });
export type TemplateListResponse = z.infer<typeof templateListResponseSchema>;

/** Iterate every item with its section, in display order. */
export function flattenItems(
  body: TemplateBody,
): { section: ChecklistSection; item: ChecklistItem }[] {
  return body.sections.flatMap((section) => section.items.map((item) => ({ section, item })));
}

export function findItem(body: TemplateBody, itemKey: string): ChecklistItem | undefined {
  for (const section of body.sections) {
    const item = section.items.find((i) => i.key === itemKey);
    if (item) return item;
  }
  return undefined;
}
