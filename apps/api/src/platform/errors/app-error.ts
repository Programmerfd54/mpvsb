import {
  buildProblem,
  ERROR_STATUS,
  type ErrorCode,
  type FieldError,
  type Problem,
} from '@context/contracts';

/**
 * Единственный тип прикладной ошибки. Контроллеры и сервисы не бросают строки
 * и не формируют HTTP-ответ вручную: фильтр превращает эту ошибку в problem+json.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: readonly FieldError[];
  readonly retryAfterSeconds: number | undefined;
  /** Подробности для журнала. Наружу не отдаются. */
  readonly internalDetail: string | undefined;

  constructor(
    code: ErrorCode,
    options: {
      title?: string;
      fieldErrors?: readonly FieldError[];
      retryAfterSeconds?: number;
      internalDetail?: string;
      cause?: unknown;
    } = {},
  ) {
    super(
      options.title ?? code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fieldErrors = options.fieldErrors ?? [];
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.internalDetail = options.internalDetail;
  }

  toProblem(requestId: string): Problem {
    return buildProblem({
      code: this.code,
      requestId,
      title: this.message === this.code ? undefined : this.message,
      fieldErrors: this.fieldErrors,
      ...(this.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: this.retryAfterSeconds }),
    });
  }

  /** Чужой или несуществующий объект отвечает одинаково: существование не раскрывается. */
  static notFound(internalDetail?: string): AppError {
    return AppError.of('NOT_FOUND', internalDetail);
  }

  static forbidden(title?: string, internalDetail?: string): AppError {
    return new AppError('FORBIDDEN', {
      ...(title ? { title } : {}),
      ...(internalDetail ? { internalDetail } : {}),
    });
  }

  static unauthenticated(internalDetail?: string): AppError {
    return AppError.of('UNAUTHENTICATED', internalDetail);
  }

  static conflict(title: string, internalDetail?: string): AppError {
    return new AppError('STATE_CONFLICT', {
      title,
      ...(internalDetail ? { internalDetail } : {}),
    });
  }

  static revisionConflict(title = 'Данные были изменены в другом окне'): AppError {
    return new AppError('REVISION_CONFLICT', { title });
  }

  static validation(fieldErrors: readonly FieldError[], title?: string): AppError {
    return new AppError('VALIDATION_FAILED', {
      fieldErrors,
      ...(title ? { title } : {}),
    });
  }

  static businessRule(title: string, fieldErrors: readonly FieldError[] = []): AppError {
    return new AppError('BUSINESS_RULE_VIOLATION', { title, fieldErrors });
  }

  private static of(code: ErrorCode, internalDetail?: string): AppError {
    return new AppError(code, internalDetail ? { internalDetail } : {});
  }
}
