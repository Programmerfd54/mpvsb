import { Pool } from 'pg';

import { loadWorkerConfig } from './env.js';
import { workerLogger } from './logger.js';
import { QUEUES, type Boss, type QueueName } from './queue.js';

/** Какое событие outbox в какую очередь попадает. */
const ROUTES: Readonly<Record<string, QueueName | null>> = {
  'attempt.submitted': QUEUES.scoreAttempt,
  'assignment.completed': null,
  'report.generation_requested': QUEUES.generateReport,
  'assignment.cancelled': null,
  'report.published': null,
  'privacy.deletion_requested': null,
};

export interface OutboxRow {
  readonly id: string;
  readonly event_type: string;
  readonly organization_id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly data_generation: string;
  readonly payload: Record<string, unknown>;
}

/**
 * Доставка событий из outbox в очередь.
 *
 * Гарантия — at-least-once: одно и то же событие может быть доставлено дважды
 * при обрыве связи между отметкой и постановкой задачи. Поэтому каждый
 * обработчик обязан быть идемпотентным по бизнес-эффекту (ТЗ 06.6).
 *
 * `for update skip locked` позволяет запускать несколько диспетчеров
 * одновременно, не обрабатывая одну строку дважды.
 */
export class OutboxDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private readonly pool: Pool;

  constructor(private readonly boss: Boss) {
    this.pool = new Pool({ connectionString: loadWorkerConfig().DATABASE_URL_WORKER, max: 2 });
  }

  start(): void {
    const interval = loadWorkerConfig().DISPATCH_INTERVAL_MS;
    const tick = async (): Promise<void> => {
      if (this.stopping) {
        return;
      }
      try {
        const delivered = await this.dispatchBatch();
        if (delivered > 0) {
          workerLogger().debug({ delivered }, 'Событий доставлено в очередь');
        }
      } catch (error) {
        workerLogger().error({ err: error }, 'Ошибка диспетчера outbox');
      }
      this.timer = setTimeout(() => void tick(), interval);
    };

    this.timer = setTimeout(() => void tick(), interval);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.pool.end();
  }

  async dispatchBatch(limit = 50): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');

      const { rows } = await client.query<OutboxRow>(
        `select id, event_type, organization_id, entity_type, entity_id,
                data_generation::text as data_generation, payload
         from platform.outbox_events
         where published_at is null and retries_stopped_at is null
         order by created_at
         limit $1
         for update skip locked`,
        [limit],
      );

      for (const row of rows) {
        const queue = ROUTES[row.event_type];
        if (queue) {
          await this.boss.send(queue, {
            outboxId: row.id,
            organizationId: row.organization_id,
            entityId: row.entity_id,
            dataGeneration: row.data_generation,
            ...row.payload,
          });
        }

        await client.query(
          'update platform.outbox_events set published_at = now(), attempts = attempts + 1 where id = $1',
          [row.id],
        );
      }

      await client.query('commit');
      return rows.length;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
