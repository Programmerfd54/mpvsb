import { Injectable } from '@nestjs/common';

import type { TenantTransaction } from '@context/database';
import { toJson } from '@context/database';

/**
 * Типы событий фоновой обработки. Список закрыт: произвольную строку
 * в очередь положить нельзя.
 */
export const OUTBOX_EVENT_TYPES = [
  'attempt.submitted',
  'assignment.completed',
  'report.generation_requested',
  'report.published',
  'assignment.cancelled',
  'privacy.deletion_requested',
] as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

export interface OutboxEventInput {
  readonly eventType: OutboxEventType;
  readonly organizationId: string;
  readonly entityType: string;
  readonly entityId: string;
  /**
   * Только идентификаторы и безопасные технические параметры.
   * Ответы участника, тексты и персональные сведения в очередь не попадают.
   */
  readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  /**
   * Поколение данных назначения на момент постановки задачи. Worker сверяет его
   * перед сохранением результата: после отмены или удаления старое задание
   * не воскресит данные (ТЗ 10.8).
   */
  readonly dataGeneration: bigint;
}

@Injectable()
export class OutboxService {
  /**
   * Запись события в той же транзакции, что и бизнес-изменение.
   *
   * Это единственный способ поставить фоновую задачу: если транзакция
   * откатится, событие исчезнет вместе с ней, и обратного случая —
   * события без изменения — тоже не будет.
   */
  async enqueue(tx: TenantTransaction, event: OutboxEventInput): Promise<void> {
    await tx.outbox_events.create({
      data: {
        event_type: event.eventType,
        organization_id: event.organizationId,
        entity_type: event.entityType,
        entity_id: event.entityId,
        payload: toJson(event.payload ?? {}),
        data_generation: event.dataGeneration,
      },
    });
  }
}
