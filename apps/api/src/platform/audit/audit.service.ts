import { Injectable } from '@nestjs/common';

import type { TenantTransaction } from '@context/database';
import type { ActorType } from '@context/domain';

import { currentRequestContext, currentRequestId } from '../request/request-context';
import { PrismaService } from '../database/prisma.service';

export type AuditOutcome = 'success' | 'denied' | 'failed';

export interface AuditEntry {
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly organizationId?: string | null;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly purpose?: string;
  /**
   * Только allowlisted технические поля. Ответы, токены, тексты заключений
   * и свободный пользовательский текст сюда не попадают (ТЗ 10.9).
   */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

const FORBIDDEN_METADATA_KEYS = new Set([
  'password',
  'token',
  'tokenHash',
  'secret',
  'sessionHash',
  'answers',
  'response',
  'content',
  'body',
  'email',
  'displayName',
]);

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Запись внутри уже открытой транзакции: аудит атомарен с самим действием. */
  async recordIn(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
    const actor = currentRequestContext()?.actor;
    await tx.audit_events.create({
      data: {
        actor_type: (actor?.type ?? 'service') as ActorType,
        actor_id: actor?.userId ?? null,
        organization_id: entry.organizationId ?? actor?.organizationId ?? null,
        action: entry.action,
        resource_type: entry.resourceType ?? null,
        resource_id: entry.resourceId ?? null,
        outcome: entry.outcome,
        request_id: currentRequestId(),
        purpose: entry.purpose ?? null,
        metadata: sanitizeMetadata(entry.metadata),
      },
    });
  }

  /**
   * Отдельная запись вне транзакции действия: отказы и неуспешные попытки,
   * которые по определению не сопровождаются бизнес-изменением.
   */
  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.platformOps((tx) => this.recordIn(tx, entry));
  }
}

export function sanitizeMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, string | number | boolean | null> {
  if (!metadata) {
    return {};
  }
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      result[key] = '[скрыто]';
      continue;
    }
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[key] =
        typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value;
    } else {
      result[key] = '[не-скалярное значение опущено]';
    }
  }
  return result;
}
