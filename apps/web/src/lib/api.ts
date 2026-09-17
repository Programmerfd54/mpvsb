import type { Problem } from '@context/contracts';

/**
 * Клиент HTTP API.
 *
 * Правила, которые он обеспечивает:
 *   * cookie сессии отправляются автоматически, токены в коде не хранятся;
 *   * изменяющие запросы несут CSRF-токен из cookie;
 *   * персональные ответы не кэшируются;
 *   * ошибка приходит как `Problem` с понятным текстом и requestId.
 */

/**
 * Базовый путь API. Относительный: запросы идут на тот же origin, что и страницы,
 * а Next перенаправляет их на внутренний адрес API (см. next.config.ts).
 */
export const API_BASE = '/api/v1';

const CSRF_COOKIE_CANDIDATES = ['__Host-csrf', 'dev_csrf'];

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.title);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.problem.status;
  }

  get code(): string {
    return this.problem.code;
  }

  /** Ошибки конкретных полей формы. */
  fieldError(field: string): string | undefined {
    return this.problem.fieldErrors.find((item) => item.field === field)?.message;
  }
}

function readCsrfToken(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  for (const name of CSRF_COOKIE_CANDIDATES) {
    const match = new RegExp(`(?:^|; )${name}=([^;]*)`).exec(document.cookie);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

export interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

export interface ListEnvelope<T> {
  data: T[];
  meta: { requestId: string; page: number; pageSize: number; total: number };
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (method !== 'GET') {
    const token = readCsrfToken();
    if (token) {
      headers['x-csrf-token'] = token;
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    // Персональные данные не должны попадать в общий кэш.
    cache: 'no-store',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(normalizeProblem(payload, response.status));
  }

  return payload as T;
}

function normalizeProblem(payload: unknown, status: number): Problem {
  if (payload !== null && typeof payload === 'object' && 'code' in payload && 'title' in payload) {
    const problem = payload as Problem;
    return { ...problem, fieldErrors: problem.fieldErrors ?? [] };
  }

  return {
    type: 'urn:context:error:internal-error',
    title: 'Сервис недоступен. Повторите попытку',
    status,
    code: 'INTERNAL_ERROR',
    requestId: 'req_unknown',
    fieldErrors: [],
    retryable: true,
  };
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Первый запрос страницы выдаёт CSRF-cookie. Вызывается до формы входа,
 * чтобы у пользователя не возникло «отправил и ничего не произошло».
 */
export async function ensureCsrfCookie(): Promise<void> {
  try {
    await fetch('/health/live', {
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    // Отсутствие сети обрабатывается формой: отдельного сообщения здесь не нужно.
  }
}
