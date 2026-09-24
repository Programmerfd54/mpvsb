import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrismaClient, type PrismaClient } from '@context/database';

import { OutboxDispatcher } from './dispatcher.js';
import { loadWorkerConfig } from './env.js';
import { workerLogger } from './logger.js';
import { createQueue, QUEUES } from './queue.js';

import { runAssignmentExpiryNotices, runExpireInvitations } from './jobs/expire-invitations.js';
import { handleGenerateReport, handleScoreAttempt, type JobPayload } from './jobs/handlers.js';

/**
 * Фоновая обработка.
 *
 * Роль БД `context_worker` не имеет доступа к схеме identity: подсчёт и
 * подготовка заключения работают без имён и адресов сотрудников. Доступа к
 * схеме `evaluation` у неё тоже нет — исходы исследования конвейеру недоступны.
 */
async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig();
  const logger = workerLogger();
  const prisma: PrismaClient = createPrismaClient('worker');
  await prisma.$connect();

  const boss = await createQueue();
  const dispatcher = new OutboxDispatcher(boss);

  await boss.work<JobPayload>(QUEUES.scoreAttempt, async (jobs) => {
    await handleScoreAttempt(prisma, jobs[0]!.data);
  });

  await boss.work<JobPayload>(QUEUES.generateReport, async (jobs) => {
    await handleGenerateReport(prisma, jobs[0]!.data);
  });

  await boss.work<Record<string, never>>(QUEUES.expireInvitations, async () => {
    // Сначала предупреждение о скором сроке, затем перевод просроченных:
    // иначе назначение успело бы стать «expired» до уведомления.
    await runAssignmentExpiryNotices(prisma);
    await runExpireInvitations(prisma);
  });

  // Ежечасная проверка сроков. Расписание живёт в очереди, не в cron хоста.
  await boss.schedule(QUEUES.expireInvitations, '0 * * * *');

  dispatcher.start();
  logger.info({ provider: config.REPORT_PROVIDER }, 'Worker запущен');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Остановка worker');
    await dispatcher.stop();
    await boss.stop({ graceful: true });
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  bootstrap().catch((error: unknown) => {
    workerLogger().fatal({ err: error }, 'Worker не запустился');
    process.exitCode = 1;
  });
}

export { bootstrap };
