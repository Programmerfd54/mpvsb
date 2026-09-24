import { PrismaPg } from '@prisma/adapter-pg';

import { databaseUrl, type DatabaseRole } from './env';
import { PrismaClient } from '../generated/prisma/index';

export type { PrismaClient };

/**
 * Клиент рабочей роли. API, worker и миграции используют разные учётные записи БД,
 * поэтому клиент всегда создаётся явно под конкретную роль.
 */
export function createPrismaClient(role: DatabaseRole): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl(role) });
  return new PrismaClient({ adapter });
}

/** Транзакционный клиент: то же API, но внутри одной транзакции. */
export type TenantTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

export interface TenantContext {
  /** Организация, подтверждённая membership или сессией участника. */
  readonly organizationId: string;
  /**
   * Эксплуатационный доступ администратора платформы.
   * Разрешает работу только с метаданными организаций — не с ответами и заключениями.
   */
  readonly platformOps?: boolean;
}

export interface TransactionOptions {
  readonly timeoutMs?: number;
  readonly maxWaitMs?: number;
  readonly isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

const DEFAULT_TX_OPTIONS = { timeoutMs: 15_000, maxWaitMs: 5_000 } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Выполняет работу в одной транзакции с transaction-local контекстом организации.
 *
 * `set_config(..., true)` обязателен: session-level SET на пуле соединений оставил бы
 * контекст следующему запросу другого tenant. Значение проверяется как UUID до записи,
 * поэтому в set_config не попадает произвольная строка.
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  context: TenantContext,
  work: (tx: TenantTransaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  if (!UUID_RE.test(context.organizationId)) {
    throw new TypeError('organizationId должен быть UUID подтверждённой организации.');
  }

  const opts = { ...DEFAULT_TX_OPTIONS, ...options };

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`select set_config('app.organization_id', ${context.organizationId}, true)`;
      if (context.platformOps === true) {
        await tx.$executeRaw`select set_config('app.platform_ops', 'on', true)`;
      }
      return work(tx as TenantTransaction);
    },
    {
      timeout: opts.timeoutMs,
      maxWait: opts.maxWaitMs,
      ...(opts.isolationLevel ? { isolationLevel: opts.isolationLevel } : {}),
    },
  );
}

/**
 * Транзакция эксплуатационного режима без конкретной организации:
 * список организаций, создание tenant, техническое состояние.
 * Ответы, evidence и заключения этим режимом не открываются — на них политика строгая.
 */
export async function withPlatformOps<T>(
  prisma: PrismaClient,
  work: (tx: TenantTransaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_TX_OPTIONS, ...options };
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`select set_config('app.platform_ops', 'on', true)`;
      return work(tx as TenantTransaction);
    },
    {
      timeout: opts.timeoutMs,
      maxWait: opts.maxWaitMs,
      ...(opts.isolationLevel ? { isolationLevel: opts.isolationLevel } : {}),
    },
  );
}
