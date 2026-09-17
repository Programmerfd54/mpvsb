import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';

import { errorTypeUrn, type AuthProfile, type ErrorCode, type Problem } from '@context/contracts';

import { mustCredentials, type E2eRole } from './env';

/**
 * HTTP-клиент E2E.
 *
 * Работает через тот же origin, что и браузер (web проксирует /api/v1 на API),
 * поэтому проверяются реальные cookie и CSRF, а не обход прокси.
 *
 * Правила:
 *   * отдельный контекст cookie на каждого актора — сессии не смешиваются;
 *   * изменяющие запросы несут double-submit CSRF-токен из cookie;
 *   * тела ответов не печатаются в лог целиком: в сообщениях только статус,
 *     код и requestId.
 */
export const API_PREFIX = '/api/v1';
const CSRF_COOKIES = ['__Host-csrf', 'dev_csrf'];

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiResult<T = any> {
  readonly status: number;
  readonly body: T;
  readonly response: APIResponse;
}

export interface RequestOptions {
  readonly body?: unknown;
  /** false — не прикладывать CSRF-заголовок (проверка защиты). */
  readonly csrf?: boolean;
  /** Явное значение заголовка CSRF вместо значения из cookie. */
  readonly csrfValue?: string;
  readonly headers?: Record<string, string>;
}

export class ApiActor {
  private constructor(
    readonly label: string,
    readonly context: APIRequestContext,
  ) {}

  static async anonymous(baseURL: string, label = 'anonymous'): Promise<ApiActor> {
    const context = await request.newContext({
      baseURL,
      extraHTTPHeaders: { accept: 'application/json' },
    });
    const actor = new ApiActor(label, context);
    await actor.ensureCsrfCookie();
    return actor;
  }

  /** Вход руководителя, рецензента или администратора через POST /auth/login. */
  static async login(baseURL: string, role: E2eRole): Promise<ApiActor & { profile: AuthProfile }> {
    const actor = await ApiActor.anonymous(baseURL, role);
    const { email, password } = mustCredentials(role);
    const result = await actor.call<{ data: AuthProfile }>('POST', '/auth/login', {
      body: { email, password },
    });
    if (result.status < 200 || result.status >= 300) {
      await actor.dispose();
      throw new Error(
        `Вход ${role} не выполнен: ${describe(result)}. Проверьте пароли из последнего npm run db:seed:demo.`,
      );
    }
    return Object.assign(actor, { profile: result.body.data });
  }

  /** Первый запрос выдаёт CSRF-cookie (как ensureCsrfCookie в web). */
  async ensureCsrfCookie(): Promise<void> {
    if (await this.csrfToken()) {
      return;
    }
    const response = await this.context.get('/health/live');
    expect(response.status(), 'health/live должен отвечать через web-прокси').toBe(200);
    expect(await this.csrfToken(), 'сервер должен выдать CSRF-cookie').toBeTruthy();
  }

  async csrfToken(): Promise<string | null> {
    const state = await this.context.storageState();
    const cookie = state.cookies.find((item) => CSRF_COOKIES.includes(item.name));
    return cookie ? decodeURIComponent(cookie.value) : null;
  }

  async cookieNames(): Promise<string[]> {
    const state = await this.context.storageState();
    return state.cookies.map((item) => item.name);
  }

  async call<T = any>(
    method: Method,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...options.headers };
    if (method !== 'GET' && options.csrf !== false) {
      const token = options.csrfValue ?? (await this.csrfToken());
      if (token) {
        headers['x-csrf-token'] = token;
      }
    }
    const url = path.startsWith('/health') ? path : `${API_PREFIX}${path}`;
    const response = await this.context.fetch(url, {
      method,
      headers,
      failOnStatusCode: false,
      maxRedirects: 0,
      ...(options.body === undefined ? {} : { data: options.body }),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status(), body: body as T, response };
  }

  get<T = any>(path: string): Promise<ApiResult<T>> {
    return this.call<T>('GET', path);
  }

  post<T = any>(path: string, body: unknown = {}, options: RequestOptions = {}) {
    return this.call<T>('POST', path, { ...options, body });
  }

  put<T = any>(path: string, body: unknown, options: RequestOptions = {}) {
    return this.call<T>('PUT', path, { ...options, body });
  }

  patch<T = any>(path: string, body: unknown, options: RequestOptions = {}) {
    return this.call<T>('PATCH', path, { ...options, body });
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }
}

/** Короткое описание ответа для сообщений assert без персональных данных. */
export function describe(result: ApiResult): string {
  const problem = asProblem(result.body);
  return problem
    ? `HTTP ${result.status} ${problem.code} (${problem.title}; requestId ${problem.requestId})`
    : `HTTP ${result.status}`;
}

export function asProblem(body: unknown): Problem | null {
  if (body !== null && typeof body === 'object' && 'code' in body && 'status' in body) {
    return body as Problem;
  }
  return null;
}

/** Успешный ответ: статус 2xx и серверный envelope с requestId. */
export function expectOk<T>(result: ApiResult<T>, what: string): T {
  expect(result.status, `${what}: ожидался успех, получено ${describe(result)}`).toBeLessThan(300);
  expect(result.status).toBeGreaterThanOrEqual(200);
  const body = result.body as any;
  expect(body?.meta?.requestId, `${what}: ответ должен содержать meta.requestId`).toBeTruthy();
  return body.data as T;
}

/**
 * Отказ в формате Problem: статус из разрешённого набора, у ответа есть код
 * и requestId, в тексте нет внутренних подробностей.
 */
export function expectProblem(
  result: ApiResult,
  allowed: readonly number[],
  what: string,
  forbiddenFragments: readonly string[] = [],
): Problem {
  expect(allowed, `${what}: получено ${describe(result)}`).toContain(result.status);
  const problem = asProblem(result.body);
  expect(problem, `${what}: ответ должен быть problem+json`).not.toBeNull();
  expect(problem!.requestId).toBeTruthy();
  /*
   * Тело и HTTP-статус обязаны совпадать: расхождение (403 в теле при 200 в
   * статусе и наоборот) — обычный источник ошибок клиента и обхода проверок
   * в интерфейсе. Тип ошибки выводится из кода по контракту, поэтому сверяется
   * тем же правилом.
   */
  expect(problem!.status, `${what}: problem.status не совпадает с HTTP-статусом`).toBe(
    result.status,
  );
  expect(problem!.type, `${what}: problem.type не соответствует коду ${problem!.code}`).toBe(
    errorTypeUrn(problem!.code as ErrorCode),
  );
  const serialized = JSON.stringify(result.body);
  for (const fragment of forbiddenFragments) {
    expect(serialized, `${what}: ответ раскрывает «${fragment}»`).not.toContain(fragment);
  }
  // Внутренние подробности (internalDetail, стек, SQL) наружу не отдаются.
  expect(serialized).not.toMatch(/membership|prisma|stack|select |internalDetail/i);
  return problem!;
}
