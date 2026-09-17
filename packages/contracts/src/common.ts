import { z } from 'zod';

export const uuidSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Максимальный размер страницы (ТЗ 08.1). */
export const PAGE_SIZE_MAX = 100;
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const responseMetaSchema = z.object({ requestId: z.string() });

export const listMetaSchema = responseMetaSchema.extend({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

/** `{ data, meta }` — единственная форма успешного ответа. */
export function dataEnvelope<T extends z.ZodType>(item: T) {
  return z.object({ data: item, meta: responseMetaSchema });
}

export function listEnvelope<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: listMetaSchema });
}

export type Envelope<T> = { data: T; meta: { requestId: string } };
export type ListEnvelope<T> = {
  data: T[];
  meta: { requestId: string; page: number; pageSize: number; total: number };
};

/** Сортировка по allowlist; произвольное поле в ORM не попадает (ТЗ 08.1). */
export function sortQuerySchema<const T extends readonly [string, ...string[]]>(
  allowed: T,
  fallback: T[number],
) {
  return z.object({
    sort: z.enum(allowed).default(fallback as never),
    order: z.enum(['asc', 'desc']).default('desc'),
  });
}

/** Результат пакетной операции по каждому элементу (ТЗ 08.2). */
export const batchItemResultSchema = z.object({
  id: z.string(),
  status: z.enum(['created', 'updated', 'skipped', 'failed']),
  message: z.string().optional(),
});

export type BatchItemResult = z.infer<typeof batchItemResultSchema>;

export const batchResultSchema = z.object({
  outcome: z.enum(['all_succeeded', 'partial', 'all_failed']),
  items: z.array(batchItemResultSchema),
});

export type BatchResult = z.infer<typeof batchResultSchema>;

/** Ограничения свободного текста (ТЗ M05, E08). */
export const TEXT_LIMITS = {
  decisionQuestion: { min: 20, max: 2000 },
  workFacts: { max: 4000 },
  constraints: { max: 2000 },
  managerOpinion: { max: 2000 },
  comment: { max: 2000 },
  shortAnswer: { max: 2000 },
  jobTitle: { max: 120 },
  department: { max: 120 },
  displayName: { max: 200 },
  externalCode: { max: 64 },
} as const;
