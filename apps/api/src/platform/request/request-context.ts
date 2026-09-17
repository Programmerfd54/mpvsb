import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { ActorType, OrgPermission } from '@context/domain';

/** Действующее лицо запроса. Типы не объединяются: participant не получает прав manager. */
export interface RequestActor {
  readonly type: ActorType;
  readonly userId?: string;
  readonly sessionId?: string;
  /** Организация подтверждена membership или сессией участника, а не телом запроса. */
  readonly organizationId?: string;
  readonly permissions?: readonly OrgPermission[];
  readonly isPlatformAdmin?: boolean;
  /** Назначение, к которому привязана сессия участника. */
  readonly assignmentId?: string;
  /** Временный грант администратора: сужает доступ целью и сроком. */
  readonly accessGrantId?: string;
}

export interface RequestContext {
  readonly requestId: string;
  actor: RequestActor | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId, actor: null }, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentRequestId(): string {
  return storage.getStore()?.requestId ?? 'req_unknown';
}

export function setRequestActor(actor: RequestActor): void {
  const store = storage.getStore();
  if (store) {
    store.actor = actor;
  }
}

export function newRequestId(): string {
  return `req_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}
