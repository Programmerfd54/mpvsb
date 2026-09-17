'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { AuthProfile, Envelope, MembershipSummary } from '@context/contracts';
import type { OrgPermission } from '@context/domain';

import { type ApiError, api } from './api';
import { useApiQuery } from './query';

export interface SessionState {
  readonly status: 'loading' | 'authenticated' | 'anonymous' | 'error';
  readonly profile: AuthProfile | null;
  readonly organization: MembershipSummary | null;
  readonly error: ApiError | null;
}

export type Session = SessionState & { has: (permission: OrgPermission) => boolean };

const SessionContext = createContext<SessionState | null>(null);

/** Общий ключ кэша: запрос `/auth/me` дедуплицируется между всеми потребителями. */
export const SESSION_QUERY_KEY = ['session'] as const;

/**
 * Один запрос `/auth/me` через общий кэш запросов.
 *
 * Дедупликацию и повторы делает react-query: двойной вызов эффекта в
 * StrictMode больше не приводит ко второму запросу, а ручной AbortController
 * не нужен — сигнал приходит из queryFn.
 */
function useSessionRequest(enabled: boolean): SessionState {
  const query = useApiQuery<Envelope<AuthProfile>>(SESSION_QUERY_KEY, '/auth/me', {
    enabled,
    // Сессия не меняется сама по себе; после входа и выхода страница перезагружается.
    staleTime: 5 * 60_000,
  });

  return useMemo<SessionState>(() => {
    if (query.error) {
      // 401 — не ошибка приложения, а обычное «не выполнен вход».
      if (query.error.status === 401) {
        return { status: 'anonymous', profile: null, organization: null, error: null };
      }
      return { status: 'error', profile: null, organization: null, error: query.error };
    }

    const profile = query.data?.data;
    if (!profile) {
      return { status: 'loading', profile: null, organization: null, error: null };
    }

    const organization =
      profile.memberships.find((item) => item.organizationId === profile.defaultOrganizationId) ??
      profile.memberships[0] ??
      null;

    return { status: 'authenticated', profile, organization, error: null };
  }, [query.data, query.error]);
}

/**
 * Источник сессии для оболочки кабинета: один запрос `/auth/me` на весь layout.
 * Страницы внутри читают результат из контекста, без повторных запросов
 * и без мигания «Проверяем доступ» при переходах.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const parent = useContext(SessionContext);
  const own = useSessionRequest(parent === null);

  return <SessionContext.Provider value={parent ?? own}>{children}</SessionContext.Provider>;
}

function withPermissions(state: SessionState): Session {
  return {
    ...state,
    has: (permission: OrgPermission) =>
      state.organization?.permissions.includes(permission) ?? false,
  };
}

/**
 * Профиль текущего пользователя.
 *
 * Внутри SessionProvider читает общий контекст; вне провайдера берёт тот же
 * ключ кэша, поэтому лишнего запроса не возникает и там.
 *
 * Разрешения приходят с сервера и используются только для того, чтобы не
 * показывать заведомо недоступное действие. Границей безопасности они не
 * являются: каждый запрос проверяется на сервере заново (ТЗ 10.4).
 */
export function useSession(): Session {
  const context = useContext(SessionContext);
  const own = useSessionRequest(context === null);
  return withPermissions(context ?? own);
}

/**
 * Выход из системы. Полная перезагрузка намеренная: кэш запросов в памяти
 * и состояние страниц не должны пережить смену пользователя.
 */
export function signOut(): Promise<void> {
  return api
    .post('/auth/logout')
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => window.location.assign('/login'));
}
