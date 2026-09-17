import { PgBoss } from 'pg-boss';

export type Boss = PgBoss;

import { loadWorkerConfig } from './env.js';

export const QUEUE_SCHEMA = 'pgboss';

/** Имена очередей. Список закрыт: произвольную очередь создать нельзя. */
export const QUEUES = {
  scoreAttempt: 'score-attempt',
  generateReport: 'generate-report',
  expireInvitations: 'expire-invitations',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Подключение к очереди.
 *
 * `migrate: false` — схему очереди создаёт владелец при миграции: у роли
 * worker нет прав CREATE/ALTER, и очередь их не запрашивает.
 */
export async function createQueue(): Promise<Boss> {
  const config = loadWorkerConfig();
  const boss = new PgBoss({
    connectionString: config.DATABASE_URL_WORKER,
    schema: QUEUE_SCHEMA,
    migrate: false,
    supervise: true,
  });

  await boss.start();

  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name);
  }

  return boss;
}
