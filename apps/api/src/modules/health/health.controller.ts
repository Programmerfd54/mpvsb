import { Controller, Get } from '@nestjs/common';

import { PrismaService } from '../../platform/database/prisma.service';
import { appLogger } from '../../platform/logging/logger';

/**
 * Проверки состояния. Публичный вывод не содержит версий, строк подключения
 * и названий организаций (ТЗ 12.7).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Живость процесса. БД намеренно не опрашивается. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Готовность обслуживать запросы: доступна БД и применены миграции. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok' | 'degraded'; checks: Record<string, boolean> }> {
    const checks: Record<string, boolean> = { database: false, migrations: false };

    try {
      await this.prisma.preContext.$queryRaw`select 1`;
      checks.database = true;
    } catch (error) {
      // Причина не раскрывается наружу; подробности уходят только в журнал.
      appLogger().error({ err: error }, 'Проверка готовности: база недоступна');
    }

    if (checks.database) {
      try {
        const rows = await this.prisma.preContext.$queryRaw<
          Array<{ applied: number }>
        >`select count(*)::int as applied from public.schema_migrations`;
        checks.migrations = (rows[0]?.applied ?? 0) > 0;
      } catch (error) {
        // Отсутствие прав или таблицы означает неготовность, а не отсутствие БД.
        appLogger().error({ err: error }, 'Проверка готовности: журнал миграций недоступен');
      }
    }

    const ok = Object.values(checks).every(Boolean);
    return { status: ok ? 'ok' : 'degraded', checks };
  }
}
