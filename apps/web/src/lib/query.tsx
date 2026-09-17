'use client';

import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData as keepPrevious,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import { ApiError, api } from './api';

export { useQueryClient };
export type { QueryKey };

/** Повтор только для сетевых сбоев и 5xx и не больше одного раза. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) {
    return false;
  }
  if (error instanceof ApiError) {
    return error.status >= 500;
  }
  // TypeError от fetch — обрыв сети; прерванный запрос не повторяем.
  return error instanceof TypeError;
}

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Кэш запросов — только в памяти вкладки. Никакого сохранения в localStorage:
 * ответы API содержат персональные данные.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export interface ApiQueryResult<T> {
  readonly data: T | undefined;
  readonly error: ApiError | null;
  /** Первая загрузка: данных ещё нет. */
  readonly isLoading: boolean;
  /** Любой запрос в полёте, включая фоновое обновление. */
  readonly isFetching: boolean;
  readonly refetch: () => void;
}

/** Ошибка, не пришедшая от API (обрыв сети), приводится к ApiError с понятным текстом. */
function toApiError(error: unknown): ApiError | null {
  if (!error) {
    return null;
  }
  if (error instanceof ApiError) {
    return error;
  }
  return new ApiError({
    type: 'urn:context:error:dependency-unavailable',
    title: 'Нет связи с сервером. Проверьте подключение и повторите попытку',
    status: 503,
    code: 'DEPENDENCY_UNAVAILABLE',
    requestId: 'req_unknown',
    fieldErrors: [],
    retryable: true,
  });
}

/**
 * GET-запрос к API с кэшем.
 *
 * `path` — путь без `/api/v1`, как в `api.get`. `null` в `path` или
 * `enabled: false` откладывает запрос (например, пока нет organizationId).
 * `T` — тип всего ответа (обычно `Envelope<X>` или `ListEnvelope<X>`).
 */
export function useApiQuery<T>(
  key: QueryKey,
  path: string | null,
  options: {
    enabled?: boolean;
    staleTime?: number;
    refetchInterval?: number | false;
    keepPreviousData?: boolean;
  } = {},
): ApiQueryResult<T> {
  const query = useQuery<T, unknown>({
    queryKey: key,
    queryFn: ({ signal }) => api.get<T>(path as string, signal),
    enabled: path !== null && (options.enabled ?? true),
    ...(options.staleTime !== undefined ? { staleTime: options.staleTime } : {}),
    ...(options.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
    ...(options.keepPreviousData ? { placeholderData: keepPrevious } : {}),
  });

  const error = useMemo(() => toApiError(query.error), [query.error]);

  return {
    data: query.data,
    error,
    isLoading: query.isPending && query.fetchStatus !== 'idle',
    isFetching: query.isFetching,
    refetch: () => {
      void query.refetch();
    },
  };
}

export interface ApiMutationResult<TVariables, TResult> {
  readonly mutate: (variables: TVariables) => void;
  readonly mutateAsync: (variables: TVariables) => Promise<TResult>;
  readonly isPending: boolean;
  readonly error: ApiError | null;
  readonly data: TResult | undefined;
  readonly reset: () => void;
}

/**
 * Изменяющий запрос. Успех сообщается только после ответа сервера;
 * после успеха инвалидируются перечисленные ключи.
 *
 * Пример: `useApiMutation((body: X) => api.post<Envelope<Y>>(path, body), { invalidate: [['employees', orgId]] })`.
 */
export function useApiMutation<TVariables = void, TResult = unknown>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  options: {
    invalidate?: readonly QueryKey[];
    onSuccess?: (result: TResult, variables: TVariables) => void;
    onError?: (error: ApiError | null, variables: TVariables) => void;
  } = {},
): ApiMutationResult<TVariables, TResult> {
  const client = useQueryClient();
  const mutation = useMutation<TResult, unknown, TVariables>({
    mutationFn,
    onSuccess: async (result, variables) => {
      if (options.invalidate) {
        await Promise.all(
          options.invalidate.map((queryKey) => client.invalidateQueries({ queryKey })),
        );
      }
      options.onSuccess?.(result, variables);
    },
    onError: (error, variables) => {
      options.onError?.(toApiError(error), variables);
    },
  });

  const error = useMemo(() => toApiError(mutation.error), [mutation.error]);

  return {
    mutate: (variables) => mutation.mutate(variables),
    mutateAsync: (variables) => mutation.mutateAsync(variables),
    isPending: mutation.isPending,
    error,
    data: mutation.data,
    reset: () => mutation.reset(),
  };
}
