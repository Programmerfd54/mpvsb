import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import {
  createPrismaClient,
  withPlatformOps,
  withTenant,
  type PrismaClient,
  type TenantContext,
  type TenantTransaction,
  type TransactionOptions,
} from '@context/database';

/**
 * Подключение API к PostgreSQL под ролью `context_api`.
 *
 * Прямого доступа к клиенту вне транзакции у модулей нет: любая работа с данными
 * организации идёт через `tenant()`, который ставит transaction-local контекст RLS.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient = createPrismaClient('api');

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Работа в границах одной организации. */
  tenant<T>(
    context: TenantContext,
    work: (tx: TenantTransaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return withTenant(this.client, context, work, options);
  }

  /**
   * Эксплуатационный режим администратора платформы: организации и техническое состояние.
   * Ответы участников и заключения этим режимом не открываются — политика на них строгая.
   */
  platformOps<T>(
    work: (tx: TenantTransaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return withPlatformOps(this.client, work, options);
  }

  /**
   * Операции до установления контекста организации: проверка сессии, резолверы.
   * Доступ к tenant-таблицам здесь закрыт политиками RLS.
   */
  get preContext(): PrismaClient {
    return this.client;
  }
}
