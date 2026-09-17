import { z } from 'zod';

/**
 * Машиночитаемые коды ошибок. Текст `title` объясняет действие пользователю,
 * не раскрывая существование чужих объектов и не содержа секретов (ТЗ 08.1, 10.9).
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'STATE_CONFLICT',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'INVITATION_EXPIRED',
  'BUSINESS_RULE_VIOLATION',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STATE_CONFLICT: 409,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  INVITATION_EXPIRED: 410,
  BUSINESS_RULE_VIOLATION: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export const ERROR_TITLES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Проверьте заполненные поля',
  UNAUTHENTICATED: 'Сессия истекла. Войдите заново',
  FORBIDDEN: 'Недостаточно прав для этого действия',
  NOT_FOUND: 'Объект не найден',
  STATE_CONFLICT: 'Состояние изменилось, действие сейчас недоступно',
  REVISION_CONFLICT: 'Данные были изменены в другом окне',
  IDEMPOTENCY_KEY_REUSED: 'Этот ключ запроса уже использован с другими данными',
  INVITATION_EXPIRED: 'Ссылка недействительна или срок истёк',
  BUSINESS_RULE_VIOLATION: 'Действие не соответствует правилам',
  RATE_LIMITED: 'Слишком много попыток. Повторите позже',
  DEPENDENCY_UNAVAILABLE: 'Сервис временно недоступен',
  INTERNAL_ERROR: 'Техническая ошибка. Повторите попытку',
};

export function errorTypeUrn(code: ErrorCode): string {
  return `urn:context:error:${code.toLowerCase().replaceAll('_', '-')}`;
}

export const fieldErrorSchema = z.object({
  /** Путь поля в исходном теле запроса, например `context.decisionQuestion`. */
  field: z.string(),
  message: z.string(),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;

/** Тело ошибки `application/problem+json` (ТЗ 08.1). */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(ERROR_CODES),
  requestId: z.string(),
  fieldErrors: z.array(fieldErrorSchema).default([]),
  retryable: z.boolean().default(false),
  /** Секунды до допустимого повтора. Присылается только вместе с 429/503. */
  retryAfterSeconds: z.number().int().positive().optional(),
});

export type Problem = z.infer<typeof problemSchema>;

export function buildProblem(input: {
  code: ErrorCode;
  requestId: string;
  title?: string;
  fieldErrors?: readonly FieldError[];
  retryable?: boolean;
  retryAfterSeconds?: number;
}): Problem {
  const status = ERROR_STATUS[input.code];
  return {
    type: errorTypeUrn(input.code),
    title: input.title ?? ERROR_TITLES[input.code],
    status,
    code: input.code,
    requestId: input.requestId,
    fieldErrors: [...(input.fieldErrors ?? [])],
    retryable: input.retryable ?? (status === 503 || status === 429),
    ...(input.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: input.retryAfterSeconds }),
  };
}
